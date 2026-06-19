import { unzipSync } from 'fflate'
import { decompress as zstdDecompress } from 'fzstd'
import Database from 'better-sqlite3'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type AnkiNoteType = {
  mid: number
  name: string
  isCloze: boolean
  fields: string[]
  templates: { name: string; qfmt: string; afmt: string }[]
  css: string
}

export type AnkiNote = {
  nid: number
  mid: number
  fields: string[] // split on \x1f
  tags: string[]
}

export type AnkiCard = {
  cid: number
  nid: number
  did: number // deck id
  ord: number
}

export type AnkiDeck = { did: number; name: string }

export type ParsedApkg = {
  noteTypes: Map<number, AnkiNoteType>
  notes: AnkiNote[]
  cards: AnkiCard[]
  decks: Map<number, AnkiDeck>
  media: Map<string, Uint8Array> // filename -> bytes
  format: string
}

const FIELD_SEP = '\x1f'

// ---- minimal protobuf reader (only what we need for media names) ----
function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0
  let shift = 0
  while (true) {
    const b = buf[pos++]
    result |= (b & 0x7f) << shift
    if ((b & 0x80) === 0) break
    shift += 7
  }
  return [result >>> 0, pos]
}

// MediaEntries { repeated MediaEntry entries = 1; }  MediaEntry { string name = 1; }
function decodeMediaEntries(buf: Uint8Array): string[] {
  const names: string[] = []
  let pos = 0
  while (pos < buf.length) {
    let tag: number
    ;[tag, pos] = readVarint(buf, pos)
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 1 && wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      const entry = buf.subarray(pos, pos + len)
      pos += len
      names.push(decodeMediaEntryName(entry))
    } else {
      pos = skipField(buf, pos, wire)
    }
  }
  return names
}

function decodeMediaEntryName(buf: Uint8Array): string {
  let pos = 0
  while (pos < buf.length) {
    let tag: number
    ;[tag, pos] = readVarint(buf, pos)
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 1 && wire === 2) {
      let len: number
      ;[len, pos] = readVarint(buf, pos)
      return new TextDecoder().decode(buf.subarray(pos, pos + len))
    }
    pos = skipField(buf, pos, wire)
  }
  return ''
}

function skipField(buf: Uint8Array, pos: number, wire: number): number {
  if (wire === 0) return readVarint(buf, pos)[1]
  if (wire === 2) {
    let len: number
    ;[len, pos] = readVarint(buf, pos)
    return pos + len
  }
  if (wire === 5) return pos + 4
  if (wire === 1) return pos + 8
  throw new Error('unsupported wire type ' + wire)
}

// ---- main parse ----
export function parseApkg(buf: Buffer): ParsedApkg {
  const files = unzipSync(new Uint8Array(buf))

  // pick the collection db
  let format = 'anki2'
  let dbBytes: Uint8Array | undefined
  if (files['collection.anki21b']) {
    format = 'anki21b'
    dbBytes = zstdDecompress(files['collection.anki21b'])
  } else if (files['collection.anki21']) {
    format = 'anki21'
    dbBytes = files['collection.anki21']
  } else if (files['collection.anki2']) {
    format = 'anki2'
    dbBytes = files['collection.anki2']
  }
  if (!dbBytes) throw new Error('No collection database found inside .apkg')

  const tmp = mkdtempSync(join(tmpdir(), 'apkg-'))
  const dbFile = join(tmp, 'collection.sqlite')
  writeFileSync(dbFile, dbBytes)

  try {
    const adb = new Database(dbFile, { readonly: true, fileMustExist: true })
    const result = readCollection(adb)
    adb.close()
    result.format = format
    result.media = readMedia(files, format)
    return result
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function hasTable(adb: Database.Database, name: string): boolean {
  return !!adb
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name)
}

function readCollection(adb: Database.Database): ParsedApkg {
  const noteTypes = new Map<number, AnkiNoteType>()
  const decks = new Map<number, AnkiDeck>()

  if (hasTable(adb, 'notetypes')) {
    // Schema 18+: separate tables
    readModernNoteTypes(adb, noteTypes)
    for (const r of adb.prepare(`SELECT id, name FROM decks`).all() as any[]) {
      decks.set(Number(r.id), { did: Number(r.id), name: r.name })
    }
  } else {
    // Schema 11: models + decks are JSON in the `col` table
    const col = adb.prepare(`SELECT models, decks FROM col LIMIT 1`).get() as any
    const models = JSON.parse(col.models)
    for (const mid of Object.keys(models)) {
      const m = models[mid]
      noteTypes.set(Number(mid), {
        mid: Number(mid),
        name: m.name,
        isCloze: m.type === 1,
        fields: (m.flds as any[]).map((f) => f.name),
        templates: (m.tmpls as any[]).map((t) => ({
          name: t.name,
          qfmt: t.qfmt,
          afmt: t.afmt,
        })),
        css: m.css ?? '',
      })
    }
    const deckJson = JSON.parse(col.decks)
    for (const did of Object.keys(deckJson)) {
      decks.set(Number(did), { did: Number(did), name: deckJson[did].name })
    }
  }

  const notes: AnkiNote[] = (
    adb.prepare(`SELECT id, mid, flds, tags FROM notes`).all() as any[]
  ).map((r) => ({
    nid: Number(r.id),
    mid: Number(r.mid),
    fields: String(r.flds).split(FIELD_SEP),
    tags: String(r.tags).trim().split(/\s+/).filter(Boolean),
  }))

  const cards: AnkiCard[] = (
    adb.prepare(`SELECT id, nid, did, ord FROM cards`).all() as any[]
  ).map((r) => ({
    cid: Number(r.id),
    nid: Number(r.nid),
    did: Number(r.did),
    ord: Number(r.ord),
  }))

  return { noteTypes, notes, cards, decks, media: new Map(), format: '' }
}

function readModernNoteTypes(
  adb: Database.Database,
  out: Map<number, AnkiNoteType>,
) {
  const types = adb.prepare(`SELECT id, name, config FROM notetypes`).all() as any[]
  const fieldsByType = new Map<number, { ord: number; name: string }[]>()
  for (const f of adb.prepare(`SELECT ntid, ord, name FROM fields`).all() as any[]) {
    const arr = fieldsByType.get(Number(f.ntid)) ?? []
    arr.push({ ord: Number(f.ord), name: f.name })
    fieldsByType.set(Number(f.ntid), arr)
  }
  const tmplByType = new Map<number, { ord: number; name: string; q: string; a: string }[]>()
  for (const t of adb
    .prepare(`SELECT ntid, ord, name, config FROM templates`)
    .all() as any[]) {
    // config is a protobuf blob; q/a formats are stored as strings inside.
    // Newer schemas keep qfmt/afmt only in the protobuf config — decode them.
    const { q, a } = decodeTemplateConfig(t.config as Buffer)
    const arr = tmplByType.get(Number(t.ntid)) ?? []
    arr.push({ ord: Number(t.ord), name: t.name, q, a })
    tmplByType.set(Number(t.ntid), arr)
  }

  for (const t of types) {
    const id = Number(t.id)
    const isCloze = decodeNotetypeIsCloze(t.config as Buffer)
    const fields = (fieldsByType.get(id) ?? [])
      .sort((x, y) => x.ord - y.ord)
      .map((f) => f.name)
    const templates = (tmplByType.get(id) ?? [])
      .sort((x, y) => x.ord - y.ord)
      .map((t) => ({ name: t.name, qfmt: t.q, afmt: t.a }))
    out.set(id, { mid: id, name: t.name, isCloze, fields, templates, css: '' })
  }
}

// Notetype.config protobuf: field 1 = kind (enum) where 1 = cloze.
function decodeNotetypeIsCloze(buf: Buffer): boolean {
  let pos = 0
  const b = new Uint8Array(buf)
  while (pos < b.length) {
    let tag: number
    ;[tag, pos] = readVarint(b, pos)
    const field = tag >>> 3
    const wire = tag & 7
    if (field === 1 && wire === 0) {
      let v: number
      ;[v, pos] = readVarint(b, pos)
      return v === 1
    }
    pos = skipField(b, pos, wire)
  }
  return false
}

// CardTemplate.config protobuf: field 1 = q_format (string), field 2 = a_format (string)
function decodeTemplateConfig(buf: Buffer): { q: string; a: string } {
  let pos = 0
  const b = new Uint8Array(buf)
  let q = ''
  let a = ''
  const dec = new TextDecoder()
  while (pos < b.length) {
    let tag: number
    ;[tag, pos] = readVarint(b, pos)
    const field = tag >>> 3
    const wire = tag & 7
    if (wire === 2 && (field === 1 || field === 2)) {
      let len: number
      ;[len, pos] = readVarint(b, pos)
      const s = dec.decode(b.subarray(pos, pos + len))
      pos += len
      if (field === 1) q = s
      else a = s
    } else {
      pos = skipField(b, pos, wire)
    }
  }
  return { q, a }
}

function readMedia(
  files: Record<string, Uint8Array>,
  format: string,
): Map<string, Uint8Array> {
  const media = new Map<string, Uint8Array>()
  const mediaEntry = files['media']
  if (!mediaEntry) return media

  // Try classic JSON map first: {"0":"name.jpg", ...}
  let nameByIndex: Record<string, string> | null = null
  try {
    nameByIndex = JSON.parse(new TextDecoder().decode(mediaEntry))
  } catch {
    nameByIndex = null
  }

  if (nameByIndex) {
    for (const [idx, name] of Object.entries(nameByIndex)) {
      const data = files[idx]
      if (data) media.set(name, data)
    }
    return media
  }

  // New format: media is a (possibly zstd-compressed) protobuf of ordered names.
  try {
    let proto = mediaEntry
    if (format === 'anki21b') {
      try {
        proto = zstdDecompress(mediaEntry)
      } catch {
        /* maybe not compressed */
      }
    }
    const names = decodeMediaEntries(proto)
    names.forEach((name, i) => {
      let data = files[String(i)]
      if (!data) return
      if (format === 'anki21b') {
        try {
          data = zstdDecompress(data)
        } catch {
          /* stored raw */
        }
      }
      if (name) media.set(name, data)
    })
  } catch {
    /* give up on media; cards still import */
  }
  return media
}
