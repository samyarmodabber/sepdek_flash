export type DeckCounts = { new: number; learning: number; due: number; total: number }

export type Scheduler = 'anki' | 'exponential' | 'leitner'
export type ExponentialConfig = { baseDays: number; hard: number; good: number; easy: number }
export type LeitnerConfig = { boxes: number[] }
export type SchedulerConfig = ExponentialConfig | LeitnerConfig | null

export type Deck = {
  id: string
  name: string
  parent_id: string | null
  created_at: number
  new_per_day: number
  rev_per_day: number
  scheduler: Scheduler
  scheduler_config: SchedulerConfig
  counts: DeckCounts
}

export type Preview = { rating: 1 | 2 | 3 | 4; label: string; display: string }
export type StudyCard = {
  id: string
  front: string
  back: string
  state: string
  css: string
}
export type StudyResponse = {
  card: StudyCard | null
  previews?: Preview[]
  counts: DeckCounts
}

export type CardRow = {
  id: string
  deck_id: string
  front_html: string
  back_html: string
  state: string
  due: number
  interval: number
  reps: number
  lapses: number
  suspended: number
  tags: string
  deck_name: string
}

export type ImportResult = {
  format: string
  decks: number
  notes: number
  cards: number
  media: number
  noteTypes: number
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

// mid -> allowed template ordinals
export type TemplateSelection = Record<number, number[]>

export type Profile = {
  id: string
  name: string
  email: string
  image: string | null
  bio: string | null
  emailVerified: boolean
  created_at: number
  hasPassword: boolean
}

export type Stats = {
  totals: { cards: number; new: number; review: number; learning: number; reviews: number }
  heatmap: { day: number; count: number }[]
  retention: number | null
  forecast: { day: number; count: number }[]
}

async function http<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...opts })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  decks: () => http<Deck[]>('/api/decks'),
  createDeck: (name: string, parentId?: string) =>
    http<{ id: string }>('/api/decks', json({ name, parentId })),
  renameDeck: (id: string, name: string) =>
    http('/api/decks/' + id, { ...json({ name }), method: 'PATCH' }),
  updateDeck: (
    id: string,
    patch: {
      name?: string
      newPerDay?: number
      revPerDay?: number
      scheduler?: Scheduler
      schedulerConfig?: SchedulerConfig
    },
  ) => http('/api/decks/' + id, { ...json(patch), method: 'PATCH' }),
  deleteDeck: (id: string) => http('/api/decks/' + id, { method: 'DELETE' }),

  inspectApkg: async (file: File): Promise<ImportInspection> => {
    const fd = new FormData()
    fd.append('file', file)
    return http<ImportInspection>('/api/import/inspect', { method: 'POST', body: fd })
  },

  importApkg: async (
    file: File,
    targetDeckId?: string,
    templateSelection?: TemplateSelection,
  ): Promise<ImportResult> => {
    const fd = new FormData()
    fd.append('file', file)
    if (targetDeckId) fd.append('targetDeckId', targetDeckId)
    if (templateSelection)
      fd.append('templateSelection', JSON.stringify(templateSelection))
    return http<ImportResult>('/api/import', { method: 'POST', body: fd })
  },

  nextCard: (deckId: string) => http<StudyResponse>(`/api/study/${deckId}/next`),
  answer: (cardId: string, rating: number, timeMs: number) =>
    http('/api/study/answer', json({ cardId, rating, timeMs })),

  cards: (params: { deckId?: string; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params.deckId) qs.set('deckId', params.deckId)
    if (params.q) qs.set('q', params.q)
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    return http<{ rows: CardRow[]; total: number }>('/api/cards?' + qs.toString())
  },
  createCard: (deckId: string, front: string, back: string) =>
    http<{ id: string }>('/api/cards', json({ deckId, front, back })),
  updateCard: (id: string, fields: string[], tags: string) =>
    http('/api/cards/' + id, { ...json({ fields, tags }), method: 'PUT' }),
  deleteCard: (id: string) => http('/api/cards/' + id, { method: 'DELETE' }),
  deleteCards: (ids: string[]) =>
    http<{ deleted: number }>('/api/cards/bulk-delete', json({ ids })),
  suspendCard: (id: string) =>
    http<{ suspended: boolean }>(`/api/cards/${id}/suspend`, json({})),
  note: (cardId: string) =>
    http<{ fields: string[]; fieldNames: string[] }>('/api/note/' + cardId),

  stats: () => http<Stats>('/api/stats'),

  profile: () => http<Profile>('/api/profile'),
  deleteAccount: () => http<{ ok: true }>('/api/profile', { method: 'DELETE' }),
}
