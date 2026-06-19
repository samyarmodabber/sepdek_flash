import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ObjectId } from 'bson'
import { prisma, userMediaDir } from '../prisma.js'
import { renderNote, type NoteType } from './render.js'
import type { ParsedApkg } from './apkg.js'

export type ImportResult = {
  format: string
  decks: number
  notes: number
  cards: number
  media: number
  noteTypes: number
}

const oid = () => new ObjectId().toHexString()
const CHUNK = 1000

function safeMediaName(name: string): string | null {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!base || base === '.' || base === '..') return null
  return base
}

async function createManyChunked<T>(rows: T[], create: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await create(rows.slice(i, i + CHUNK))
  }
}

export type ImportOptions = {
  // When set, all imported cards go into this existing deck (the .apkg's own
  // deck structure is ignored). When omitted, decks are created from the file.
  targetDeckId?: string
  // Per note-type whitelist of template ordinals to import (mid -> allowed ords).
  // A mid absent from the map imports all of its templates. Ignored for cloze
  // note types, whose card `ord` is the cloze number, not a fixed template index.
  templateSelection?: Record<number, number[]>
}

export type ImportInspection = {
  format: string
  noteTypes: {
    mid: number
    name: string
    isCloze: boolean
    noteCount: number
    templates: { ord: number; name: string; cardCount: number }[]
  }[]
}

// Summarize a parsed .apkg so the UI can let the user pick which templates to
// import. Writes nothing — purely a read over the in-memory parse.
export function inspectApkg(parsed: ParsedApkg): ImportInspection {
  const nidToMid = new Map(parsed.notes.map((n) => [n.nid, n.mid]))
  const noteCount = new Map<number, number>()
  for (const n of parsed.notes) noteCount.set(n.mid, (noteCount.get(n.mid) ?? 0) + 1)
  const cardCount = new Map<string, number>() // `${mid}:${ord}` -> count
  for (const c of parsed.cards) {
    const mid = nidToMid.get(c.nid)
    if (mid === undefined) continue
    const k = `${mid}:${c.ord}`
    cardCount.set(k, (cardCount.get(k) ?? 0) + 1)
  }
  return {
    format: parsed.format,
    noteTypes: [...parsed.noteTypes].map(([mid, nt]) => ({
      mid,
      name: nt.name,
      isCloze: nt.isCloze,
      noteCount: noteCount.get(mid) ?? 0,
      templates: nt.templates.map((t, ord) => ({
        ord,
        name: t.name,
        cardCount: cardCount.get(`${mid}:${ord}`) ?? 0,
      })),
    })),
  }
}

export async function importApkg(
  parsed: ParsedApkg,
  userId: string,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const now = new Date()
  const mediaPrefix = `/media/${userId}/`

  // ---- note types ----
  const midToTypeId = new Map<number, string>()
  const noteTypeRows = [...parsed.noteTypes].map(([mid, nt]) => {
    const id = oid()
    midToTypeId.set(mid, id)
    return {
      id,
      userId,
      name: nt.name,
      isCloze: nt.isCloze,
      fields: nt.fields,
      templates: nt.templates,
      css: nt.css,
    }
  })

  // ---- decks (with :: hierarchy). Built now, inserted after the card loop so
  //      any "Imported" fallback deck is included in a single write. ----
  const fullNameToId = new Map<string, string>()
  const didToDeckId = new Map<number, string>()
  const deckRows: {
    id: string
    userId: string
    name: string
    parentId: string | null
    createdAt: Date
  }[] = []

  const ensureDeck = (fullName: string): string => {
    if (fullNameToId.has(fullName)) return fullNameToId.get(fullName)!
    const parts = fullName.split('::')
    let parentId: string | null = null
    let lastId = ''
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}::${part}` : part
      if (fullNameToId.has(acc)) {
        lastId = fullNameToId.get(acc)!
      } else {
        const id = oid()
        deckRows.push({ id, userId, name: part, parentId, createdAt: now })
        fullNameToId.set(acc, id)
        lastId = id
      }
      parentId = lastId
    }
    return lastId
  }

  // Only recreate the file's deck hierarchy when importing into new decks.
  if (!opts.targetDeckId) {
    for (const [did, deck] of parsed.decks) {
      if (deck.name === 'Default' && parsed.cards.every((c) => c.did !== did)) continue
      didToDeckId.set(did, ensureDeck(deck.name))
    }
  }

  // ---- notes (+ cache rendered cards) ----
  const nidToNoteId = new Map<number, string>()
  const nidToMid = new Map<number, number>()
  const renderCache = new Map<number, ReturnType<typeof renderNote>>()
  const noteRows: {
    id: string
    userId: string
    noteTypeId: string
    fields: string[]
    tags: string
    createdAt: Date
  }[] = []

  for (const note of parsed.notes) {
    const typeId = midToTypeId.get(note.mid)
    if (typeId === undefined) continue
    const id = oid()
    nidToNoteId.set(note.nid, id)
    nidToMid.set(note.nid, note.mid)
    noteRows.push({
      id,
      userId,
      noteTypeId: typeId,
      fields: note.fields,
      tags: note.tags.join(' '),
      createdAt: now,
    })
    const nt = parsed.noteTypes.get(note.mid)!
    const rnt: NoteType = {
      isCloze: nt.isCloze,
      fields: nt.fields,
      templates: nt.templates,
      css: nt.css,
    }
    renderCache.set(note.nid, renderNote(rnt, note.fields, mediaPrefix))
  }

  // ---- cards (may add an "Imported" fallback deck for orphan cards) ----
  let dueOffset = 0
  const cardRows: {
    id: string
    userId: string
    noteId: string
    deckId: string
    templateOrd: number
    frontHtml: string
    backHtml: string
    state: string
    due: Date
    interval: number
    easeFactor: number
    reps: number
    lapses: number
    learningStep: number
    suspended: boolean
  }[] = []

  for (const card of parsed.cards) {
    const noteId = nidToNoteId.get(card.nid)
    if (noteId === undefined) continue

    // Honor the user's template whitelist. Cloze note types are never filtered
    // here: their `ord` is the cloze number, not a template index.
    const mid = nidToMid.get(card.nid)
    const allowed = mid !== undefined ? opts.templateSelection?.[mid] : undefined
    const isCloze = mid !== undefined ? parsed.noteTypes.get(mid)?.isCloze : false
    if (allowed && !isCloze && !allowed.includes(card.ord)) continue

    const deckId =
      opts.targetDeckId ?? didToDeckId.get(card.did) ?? ensureDeck('Imported')

    const rendered = renderCache.get(card.nid) ?? []
    const match =
      rendered.find((r) => r.ord === card.ord) ?? rendered[0] ?? { front: '', back: '' }

    cardRows.push({
      id: oid(),
      userId,
      noteId,
      deckId,
      templateOrd: card.ord,
      frontHtml: match.front,
      backHtml: match.back,
      state: 'new',
      due: new Date(now.getTime() + dueOffset++),
      interval: 0,
      easeFactor: 2.5,
      reps: 0,
      lapses: 0,
      learningStep: 0,
      suspended: false,
    })
  }

  // ---- persist (Mongo has no FK checks on createMany, so order is irrelevant) ----
  await createManyChunked(noteTypeRows, (c) => prisma.noteType.createMany({ data: c }))
  await createManyChunked(deckRows, (c) => prisma.deck.createMany({ data: c }))
  await createManyChunked(noteRows, (c) => prisma.note.createMany({ data: c }))
  await createManyChunked(cardRows, (c) => prisma.card.createMany({ data: c }))

  // ---- media (per user) ----
  let mediaCount = 0
  const dir = userMediaDir(userId)
  for (const [name, bytes] of parsed.media) {
    const safe = safeMediaName(name)
    if (!safe) continue
    try {
      writeFileSync(join(dir, safe), bytes)
      mediaCount++
    } catch {
      /* skip unwritable */
    }
  }

  return {
    format: parsed.format,
    decks: deckRows.length,
    notes: noteRows.length,
    cards: cardRows.length,
    media: mediaCount,
    noteTypes: noteTypeRows.length,
  }
}
