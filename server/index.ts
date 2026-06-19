import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node'
import { Prisma } from '@prisma/client'
import { prisma, MEDIA_DIR } from './prisma.js'
import { auth } from './auth.js'
import { parseApkg } from './anki/apkg.js'
import { importApkg, inspectApkg } from './anki/normalize.js'
import {
  schedule,
  previews,
  normalizeExponential,
  normalizeLeitner,
  type Rating,
  type Scheduler,
  type SrsState,
} from './srs.js'
import { renderNote, type NoteType } from './anki/render.js'

const app = express()

// better-auth handler MUST come before express.json() (it reads the raw body).
app.all(/^\/api\/auth\/.*/, toNodeHandler(auth))

app.use(express.json({ limit: '4mb' }))
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
})

// ---------- auth gate ----------
async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })
    if (!session?.user) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    ;(req as any).userId = session.user.id
    next()
  } catch (e) {
    fail(res, e)
  }
}
app.use('/api', requireAuth)

const uid = (req: Request) => (req as any).userId as string

// ---------- async wrapper ----------
const wrap =
  (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((e) => fail(res, e))
  }

function fail(res: Response, e: unknown) {
  console.error(e)
  res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
}

// ---------- helpers ----------
const startOfToday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

async function descendantDeckIds(userId: string, deckId: string): Promise<string[]> {
  const all = await prisma.deck.findMany({
    where: { userId },
    select: { id: true, parentId: true },
  })
  const childrenOf = new Map<string, string[]>()
  for (const d of all) {
    if (!d.parentId) continue
    const arr = childrenOf.get(d.parentId) ?? []
    arr.push(d.id)
    childrenOf.set(d.parentId, arr)
  }
  const ids = [deckId]
  const queue = [deckId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const c of childrenOf.get(cur) ?? []) {
      ids.push(c)
      queue.push(c)
    }
  }
  return ids
}

function srsFromCard(c: {
  state: string
  due: Date
  interval: number
  easeFactor: number
  reps: number
  lapses: number
  learningStep: number
  box: number | null
}): SrsState {
  return {
    state: c.state as SrsState['state'],
    due: c.due.getTime(),
    interval: c.interval,
    ease_factor: c.easeFactor,
    reps: c.reps,
    lapses: c.lapses,
    learning_step: c.learningStep,
    box: c.box ?? 0,
  }
}

async function deckCounts(userId: string, deckId: string, now: Date) {
  const ids = await descendantDeckIds(userId, deckId)
  const deckIn = { in: ids }

  const [newDone, deck, newAvail, learning, due, total] = await Promise.all([
    prisma.review.count({
      where: {
        userId,
        prevState: 'new',
        reviewedAt: { gte: startOfToday() },
        card: { deckId: deckIn },
      },
    }),
    prisma.deck.findUnique({ where: { id: deckId }, select: { newPerDay: true } }),
    prisma.card.count({ where: { userId, state: 'new', suspended: false, deckId: deckIn } }),
    prisma.card.count({
      where: {
        userId,
        suspended: false,
        deckId: deckIn,
        state: { in: ['learning', 'relearning'] },
        due: { lte: now },
      },
    }),
    prisma.card.count({
      where: { userId, suspended: false, deckId: deckIn, state: 'review', due: { lte: now } },
    }),
    prisma.card.count({ where: { userId, deckId: deckIn } }),
  ])

  const newLimit = Math.max(0, (deck?.newPerDay ?? 20) - newDone)
  return { new: Math.min(newAvail, newLimit), learning, due, total }
}

async function nextStudyCard(userId: string, deckId: string, now: Date) {
  const ids = await descendantDeckIds(userId, deckId)
  const deckIn = { in: ids }

  const learning = await prisma.card.findFirst({
    where: {
      userId,
      suspended: false,
      deckId: deckIn,
      state: { in: ['learning', 'relearning'] },
      due: { lte: now },
    },
    orderBy: { due: 'asc' },
  })
  if (learning) return learning

  const review = await prisma.card.findFirst({
    where: { userId, suspended: false, deckId: deckIn, state: 'review', due: { lte: now } },
    orderBy: { due: 'asc' },
  })
  if (review) return review

  const counts = await deckCounts(userId, deckId, now)
  if (counts.new > 0) {
    return prisma.card.findFirst({
      where: { userId, suspended: false, deckId: deckIn, state: 'new' },
      orderBy: { due: 'asc' },
    })
  }
  return null
}

// Scheduling mode + config for a specific deck (a card uses its own deck's
// settings, which may differ from the deck the user launched study from).
async function deckScheduler(
  deckId: string,
): Promise<{ scheduler: Scheduler; config: unknown }> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { scheduler: true, schedulerConfig: true },
  })
  return {
    scheduler: (deck?.scheduler as Scheduler) ?? 'anki',
    config: deck?.schedulerConfig ?? undefined,
  }
}

async function basicNoteTypeId(userId: string): Promise<string> {
  const existing = await prisma.noteType.findFirst({ where: { userId, name: 'Basic' } })
  if (existing) return existing.id
  const created = await prisma.noteType.create({
    data: {
      userId,
      name: 'Basic',
      isCloze: false,
      fields: ['Front', 'Back'],
      templates: [
        { name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id="answer">{{Back}}' },
      ],
      css: '.card{font-size:20px;text-align:center;}',
    },
  })
  return created.id
}

// ---------- routes ----------
app.get(
  '/api/profile',
  wrap(async (req, res) => {
    const userId = uid(req)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        bio: true,
        emailVerified: true,
        createdAt: true,
      },
    })
    if (!user) return res.status(404).json({ error: 'not found' })
    // A credential account means the user has a password to change.
    const credential = await prisma.account.findFirst({
      where: { userId, providerId: 'credential' },
      select: { id: true },
    })
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      bio: user.bio,
      emailVerified: user.emailVerified,
      created_at: user.createdAt.getTime(),
      hasPassword: !!credential,
    })
  }),
)

app.delete(
  '/api/profile',
  wrap(async (req, res) => {
    // Cascades to sessions, accounts, decks, notes, cards and reviews via the
    // onDelete: Cascade relations on the User model.
    await prisma.user.delete({ where: { id: uid(req) } })
    res.json({ ok: true })
  }),
)

// Step 1 of import: parse the file and report its note types / templates so the
// user can choose which templates to bring in. Writes nothing.
app.post(
  '/api/import/inspect',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    res.json(inspectApkg(parseApkg(req.file.buffer)))
  }),
)

app.post(
  '/api/import',
  upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const userId = uid(req)
    const targetDeckId = req.body?.targetDeckId
      ? String(req.body.targetDeckId)
      : undefined
    if (targetDeckId) {
      const deck = await prisma.deck.findFirst({ where: { id: targetDeckId, userId } })
      if (!deck) return res.status(404).json({ error: 'target deck not found' })
    }
    let templateSelection: Record<number, number[]> | undefined
    if (req.body?.templateSelection) {
      try {
        templateSelection = JSON.parse(String(req.body.templateSelection))
      } catch {
        return res.status(400).json({ error: 'invalid templateSelection' })
      }
    }
    const parsed = parseApkg(req.file.buffer)
    const result = await importApkg(parsed, userId, { targetDeckId, templateSelection })
    res.json(result)
  }),
)

app.get(
  '/api/decks',
  wrap(async (req, res) => {
    const userId = uid(req)
    const now = new Date()
    const decks = await prisma.deck.findMany({ where: { userId }, orderBy: { name: 'asc' } })
    const withCounts = await Promise.all(
      decks.map(async (d) => ({
        id: d.id,
        name: d.name,
        parent_id: d.parentId,
        created_at: d.createdAt.getTime(),
        new_per_day: d.newPerDay,
        rev_per_day: d.revPerDay,
        scheduler: d.scheduler ?? 'anki',
        scheduler_config: d.schedulerConfig,
        counts: await deckCounts(userId, d.id, now),
      })),
    )
    res.json(withCounts)
  }),
)

app.post(
  '/api/decks',
  wrap(async (req, res) => {
    const userId = uid(req)
    const name = String(req.body?.name ?? '').trim()
    const parentId = req.body?.parentId ? String(req.body.parentId) : null
    if (!name) return res.status(400).json({ error: 'name required' })
    if (parentId) {
      const parent = await prisma.deck.findFirst({ where: { id: parentId, userId } })
      if (!parent) return res.status(404).json({ error: 'parent deck not found' })
    }
    const deck = await prisma.deck.create({ data: { userId, name, parentId } })
    res.json({ id: deck.id, name })
  }),
)

app.patch(
  '/api/decks/:id',
  wrap(async (req, res) => {
    const userId = uid(req)
    const data: Prisma.DeckUpdateInput = {}

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name) return res.status(400).json({ error: 'name required' })
      data.name = name
    }
    // Daily study limits. Clamp to a sane range so a stray value can't make the
    // deck unstudiable or pull an unbounded number of new cards.
    if (req.body?.newPerDay !== undefined) {
      const n = Math.round(Number(req.body.newPerDay))
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'newPerDay invalid' })
      data.newPerDay = Math.min(9999, n)
    }
    if (req.body?.revPerDay !== undefined) {
      const n = Math.round(Number(req.body.revPerDay))
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'revPerDay invalid' })
      data.revPerDay = Math.min(9999, n)
    }
    if (req.body?.scheduler !== undefined) {
      const mode = String(req.body.scheduler)
      if (!['anki', 'exponential', 'leitner'].includes(mode))
        return res.status(400).json({ error: 'unknown scheduler' })
      data.scheduler = mode
    }
    // Normalize the config to the chosen mode so we never persist garbage. The
    // mode used is the incoming one if present, else whatever is already stored.
    if (req.body?.schedulerConfig !== undefined) {
      const mode =
        data.scheduler ??
        (await prisma.deck.findFirst({
          where: { id: String(req.params.id), userId },
          select: { scheduler: true },
        }))?.scheduler
      data.schedulerConfig =
        mode === 'leitner'
          ? normalizeLeitner(req.body.schedulerConfig)
          : mode === 'exponential'
            ? normalizeExponential(req.body.schedulerConfig)
            : (req.body.schedulerConfig ?? Prisma.DbNull)
    }
    if (Object.keys(data).length === 0)
      return res.status(400).json({ error: 'nothing to update' })

    const deckId = String(req.params.id)
    const result = await prisma.deck.updateMany({
      where: { id: deckId, userId },
      data,
    })
    if (result.count === 0) return res.status(404).json({ error: 'deck not found' })

    // Scheduling mode is inherited: changing a deck's scheduler (or its config)
    // pushes the parent's resulting mode + config down to every subdeck, so a
    // whole tree always studies the same way. Name / daily limits are NOT
    // cascaded — those stay per-deck.
    if (data.scheduler !== undefined || data.schedulerConfig !== undefined) {
      const parent = await prisma.deck.findFirst({
        where: { id: deckId, userId },
        select: { scheduler: true, schedulerConfig: true },
      })
      const subIds = (await descendantDeckIds(userId, deckId)).filter((id) => id !== deckId)
      if (parent && subIds.length > 0) {
        const subData: Prisma.DeckUpdateInput = {
          scheduler: parent.scheduler ?? 'anki',
          // pass the parent's config through verbatim (null clears it)
          schedulerConfig: parent.schedulerConfig as Prisma.InputJsonValue | null,
        }
        await prisma.deck.updateMany({ where: { id: { in: subIds }, userId }, data: subData })
      }
    }

    res.json({ ok: true })
  }),
)

app.delete(
  '/api/decks/:id',
  wrap(async (req, res) => {
    const userId = uid(req)
    const ids = await descendantDeckIds(userId, String(req.params.id))
    // delete the deck and all its subdecks (cards cascade via relations)
    await prisma.deck.deleteMany({ where: { userId, id: { in: ids } } })
    res.json({ ok: true })
  }),
)

app.get(
  '/api/study/:deckId/next',
  wrap(async (req, res) => {
    const userId = uid(req)
    const now = new Date()
    const deckId = String(req.params.deckId)
    const card = await nextStudyCard(userId, deckId, now)
    const counts = await deckCounts(userId, deckId, now)
    if (!card) return res.json({ card: null, counts })
    const note = await prisma.note.findUnique({
      where: { id: card.noteId },
      include: { noteType: { select: { css: true } } },
    })
    const { scheduler, config } = await deckScheduler(card.deckId)
    res.json({
      card: {
        id: card.id,
        front: card.frontHtml,
        back: card.backHtml,
        state: card.state,
        css: note?.noteType.css ?? '',
      },
      previews: previews(srsFromCard(card), now.getTime(), scheduler, config),
      counts,
    })
  }),
)

app.post(
  '/api/study/answer',
  wrap(async (req, res) => {
    const userId = uid(req)
    const nowMs = Date.now()
    const cardId = String(req.body?.cardId ?? '')
    const rating = Number(req.body?.rating) as Rating
    const timeMs = Number(req.body?.timeMs ?? 0)
    if (![1, 2, 3, 4].includes(rating))
      return res.status(400).json({ error: 'rating must be 1..4' })

    const card = await prisma.card.findFirst({ where: { id: cardId, userId } })
    if (!card) return res.status(404).json({ error: 'card not found' })

    const prev = srsFromCard(card)
    const { scheduler, config } = await deckScheduler(card.deckId)
    const next = schedule(prev, rating, nowMs, scheduler, config)

    await prisma.$transaction([
      prisma.card.update({
        where: { id: cardId },
        data: {
          state: next.state,
          due: new Date(next.due),
          interval: next.interval,
          easeFactor: next.ease_factor,
          reps: next.reps,
          lapses: next.lapses,
          learningStep: next.learning_step,
          box: next.box,
          lastReviewed: new Date(nowMs),
        },
      }),
      prisma.review.create({
        data: {
          userId,
          cardId,
          reviewedAt: new Date(nowMs),
          rating,
          prevState: prev.state,
          interval: next.interval,
          easeFactor: next.ease_factor,
          timeMs,
        },
      }),
    ])
    res.json({ ok: true })
  }),
)

app.get(
  '/api/cards',
  wrap(async (req, res) => {
    const userId = uid(req)
    const q = String(req.query.q ?? '').trim()
    const limit = Math.min(500, Number(req.query.limit ?? 100))
    const offset = Number(req.query.offset ?? 0)

    const where: Prisma.CardWhereInput = { userId }
    if (req.query.deckId) {
      where.deckId = { in: await descendantDeckIds(userId, String(req.query.deckId)) }
    }
    if (q) {
      where.OR = [
        { frontHtml: { contains: q } },
        { backHtml: { contains: q } },
        { note: { is: { tags: { contains: q } } } },
      ]
    }

    const [rows, total] = await Promise.all([
      prisma.card.findMany({
        where,
        orderBy: { id: 'desc' },
        take: limit,
        skip: offset,
        include: { deck: { select: { name: true } }, note: { select: { tags: true } } },
      }),
      prisma.card.count({ where }),
    ])

    res.json({
      rows: rows.map((c) => ({
        id: c.id,
        deck_id: c.deckId,
        front_html: c.frontHtml,
        back_html: c.backHtml,
        state: c.state,
        due: c.due.getTime(),
        interval: c.interval,
        reps: c.reps,
        lapses: c.lapses,
        suspended: c.suspended ? 1 : 0,
        tags: c.note.tags,
        deck_name: c.deck.name,
      })),
      total,
    })
  }),
)

app.post(
  '/api/cards',
  wrap(async (req, res) => {
    const userId = uid(req)
    const deckId = String(req.body?.deckId ?? '')
    const front = String(req.body?.front ?? '').trim()
    const back = String(req.body?.back ?? '').trim()
    if (!deckId || !front) return res.status(400).json({ error: 'deckId and front required' })

    const deck = await prisma.deck.findFirst({ where: { id: deckId, userId } })
    if (!deck) return res.status(404).json({ error: 'deck not found' })

    const typeId = await basicNoteTypeId(userId)
    const note = await prisma.note.create({
      data: { userId, noteTypeId: typeId, fields: [front, back], tags: '' },
    })
    const card = await prisma.card.create({
      data: {
        userId,
        noteId: note.id,
        deckId,
        frontHtml: front,
        backHtml: `${front}<hr id="answer">${back}`,
        state: 'new',
        due: new Date(),
      },
    })
    res.json({ id: card.id })
  }),
)

app.put(
  '/api/cards/:id',
  wrap(async (req, res) => {
    const userId = uid(req)
    const card = await prisma.card.findFirst({
      where: { id: String(req.params.id), userId },
      include: { note: { include: { noteType: true } } },
    })
    if (!card) return res.status(404).json({ error: 'not found' })

    const nt = card.note.noteType
    // Accept the full field list (one entry per note-type field) plus optional tags.
    const incoming = Array.isArray(req.body?.fields) ? req.body.fields : null
    if (!incoming) return res.status(400).json({ error: 'fields required' })
    const fields = nt.fields.map((_, i) => String(incoming[i] ?? ''))
    const tags = typeof req.body?.tags === 'string' ? req.body.tags.trim() : card.note.tags

    // Re-render every card this note produces, using the note type's templates,
    // so multi-field / cloze notes stay consistent (not just Front/Back).
    const rendered = renderNote(
      {
        isCloze: nt.isCloze,
        fields: nt.fields,
        templates: nt.templates as unknown as NoteType['templates'],
        css: nt.css,
      },
      fields,
      `/media/${userId}/`,
    )
    const noteCards = await prisma.card.findMany({ where: { noteId: card.noteId, userId } })

    await prisma.$transaction([
      prisma.note.update({ where: { id: card.noteId }, data: { fields, tags } }),
      ...noteCards.map((c) => {
        const match =
          rendered.find((r) => r.ord === c.templateOrd) ?? rendered[0] ?? { front: '', back: '' }
        return prisma.card.update({
          where: { id: c.id },
          data: { frontHtml: match.front, backHtml: match.back },
        })
      }),
    ])
    res.json({ ok: true })
  }),
)

app.post(
  '/api/cards/:id/suspend',
  wrap(async (req, res) => {
    const userId = uid(req)
    const card = await prisma.card.findFirst({ where: { id: String(req.params.id), userId } })
    if (!card) return res.status(404).json({ error: 'not found' })
    const updated = await prisma.card.update({
      where: { id: card.id },
      data: { suspended: !card.suspended },
    })
    res.json({ suspended: updated.suspended })
  }),
)

app.delete(
  '/api/cards/:id',
  wrap(async (req, res) => {
    await prisma.card.deleteMany({ where: { id: String(req.params.id), userId: uid(req) } })
    res.json({ ok: true })
  }),
)

app.post(
  '/api/cards/bulk-delete',
  wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : []
    if (ids.length === 0) return res.status(400).json({ error: 'ids required' })
    const result = await prisma.card.deleteMany({
      where: { id: { in: ids }, userId: uid(req) },
    })
    res.json({ deleted: result.count })
  }),
)

app.get(
  '/api/note/:cardId',
  wrap(async (req, res) => {
    const card = await prisma.card.findFirst({
      where: { id: String(req.params.cardId), userId: uid(req) },
      include: { note: { include: { noteType: { select: { fields: true } } } } },
    })
    if (!card) return res.status(404).json({ error: 'not found' })
    res.json({ fields: card.note.fields, fieldNames: card.note.noteType.fields })
  }),
)

app.get(
  '/api/stats',
  wrap(async (req, res) => {
    const userId = uid(req)
    const now = new Date()
    const DAY = 86_400_000

    const [cards, newC, review, learning, relearning, reviews] = await Promise.all([
      prisma.card.count({ where: { userId } }),
      prisma.card.count({ where: { userId, state: 'new' } }),
      prisma.card.count({ where: { userId, state: 'review' } }),
      prisma.card.count({ where: { userId, state: 'learning' } }),
      prisma.card.count({ where: { userId, state: 'relearning' } }),
      prisma.review.count({ where: { userId } }),
    ])

    // heatmap: reviews grouped by epoch-day
    const revRows = await prisma.review.findMany({
      where: { userId },
      select: { reviewedAt: true },
    })
    const heatMap = new Map<number, number>()
    for (const r of revRows) {
      const day = Math.floor(r.reviewedAt.getTime() / DAY)
      heatMap.set(day, (heatMap.get(day) ?? 0) + 1)
    }
    const heatmap = [...heatMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, count]) => ({ day, count }))

    // retention: review-stage answers that were not "Again"
    const [retTotal, retGood] = await Promise.all([
      prisma.review.count({ where: { userId, prevState: 'review' } }),
      prisma.review.count({ where: { userId, prevState: 'review', rating: { gt: 1 } } }),
    ])
    const retention = retTotal ? Math.round((retGood / retTotal) * 100) : null

    // forecast: due review cards over the next 30 days
    const dueRows = await prisma.card.findMany({
      where: { userId, state: 'review', due: { gt: now } },
      select: { due: true },
    })
    const fMap = new Map<number, number>()
    for (const c of dueRows) {
      const day = Math.floor((c.due.getTime() - now.getTime()) / DAY)
      if (day >= 0 && day < 30) fMap.set(day, (fMap.get(day) ?? 0) + 1)
    }
    const forecast = [...fMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, count]) => ({ day, count }))

    res.json({
      totals: { cards, new: newC, review, learning: learning + relearning, reviews },
      heatmap,
      retention,
      forecast,
    })
  }),
)

// ---------- production: serve built frontend ----------
const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))
