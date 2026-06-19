// End-to-end smoke test: build a classic .apkg in memory, parse + import it,
// then exercise the SM-2 scheduler. Run with: npx tsx scripts/smoke.ts
import Database from 'better-sqlite3'
import { zipSync, strToU8 } from 'fflate'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseApkg } from '../server/anki/apkg.js'
import { renderNote } from '../server/anki/render.js'
import { schedule, newCardState } from '../server/srs.js'

function buildAnkiCollection(): Uint8Array {
  const tmp = mkdtempSync(join(tmpdir(), 'mkcol-'))
  const f = join(tmp, 'collection.anki2')
  const db = new Database(f)
  db.exec(`
    CREATE TABLE col (id INTEGER, models TEXT, decks TEXT);
    CREATE TABLE notes (id INTEGER, mid INTEGER, flds TEXT, tags TEXT);
    CREATE TABLE cards (id INTEGER, nid INTEGER, did INTEGER, ord INTEGER);
  `)

  const basicMid = 1001
  const clozeMid = 1002
  const models = {
    [basicMid]: {
      id: basicMid,
      name: 'Basic',
      type: 0,
      flds: [{ name: 'Front', ord: 0 }, { name: 'Back', ord: 1 }],
      tmpls: [
        { name: 'Card 1', ord: 0, qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr>{{Back}}' },
      ],
      css: '.card{font-family:sans-serif;}',
    },
    [clozeMid]: {
      id: clozeMid,
      name: 'Cloze',
      type: 1,
      flds: [{ name: 'Text', ord: 0 }, { name: 'Extra', ord: 1 }],
      tmpls: [
        { name: 'Cloze', ord: 0, qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' },
      ],
      css: '.card{}',
    },
  }
  const decks = {
    1: { id: 1, name: 'Default' },
    5: { id: 5, name: 'Spanish::Verbs' },
  }
  db.prepare(`INSERT INTO col (id, models, decks) VALUES (1, ?, ?)`).run(
    JSON.stringify(models),
    JSON.stringify(decks),
  )

  const FS = '\x1f'
  // basic note + card, with an image reference
  db.prepare(`INSERT INTO notes (id,mid,flds,tags) VALUES (?,?,?,?)`).run(
    2001,
    basicMid,
    `hola <img src="flag.png">${FS}hello`,
    ' greeting ',
  )
  db.prepare(`INSERT INTO cards (id,nid,did,ord) VALUES (?,?,?,?)`).run(3001, 2001, 5, 0)

  // cloze note producing two cards (c1 and c2)
  db.prepare(`INSERT INTO notes (id,mid,flds,tags) VALUES (?,?,?,?)`).run(
    2002,
    clozeMid,
    `The capital of {{c1::France}} is {{c2::Paris}}${FS}geo`,
    '',
  )
  db.prepare(`INSERT INTO cards (id,nid,did,ord) VALUES (?,?,?,?)`).run(3002, 2002, 5, 0)
  db.prepare(`INSERT INTO cards (id,nid,did,ord) VALUES (?,?,?,?)`).run(3003, 2002, 5, 1)

  db.close()
  const bytes = readFileSync(f)
  rmSync(tmp, { recursive: true, force: true })

  const apkg = zipSync({
    'collection.anki2': new Uint8Array(bytes),
    media: strToU8(JSON.stringify({ 0: 'flag.png' })),
    0: strToU8('FAKE-PNG-BYTES'),
  })
  return apkg
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error('ASSERT FAILED: ' + msg)
  console.log('  ok -', msg)
}

console.log('1) build + parse .apkg')
const apkg = Buffer.from(buildAnkiCollection())
const parsed = parseApkg(apkg)
assert(parsed.format === 'anki2', `format detected: ${parsed.format}`)
assert(parsed.noteTypes.size === 2, 'two note types')
assert(parsed.notes.length === 2, 'two notes')
assert(parsed.cards.length === 3, 'three cards')
assert(parsed.decks.get(5)?.name === 'Spanish::Verbs', 'deck name parsed')
assert(parsed.media.get('flag.png') !== undefined, 'media file mapped')

console.log('2) render templates')
const basicNote = parsed.notes.find((n) => n.mid === 1001)!
const basicNt = parsed.noteTypes.get(1001)!
const rb = renderNote(
  { isCloze: false, fields: basicNt.fields, templates: basicNt.templates, css: basicNt.css },
  basicNote.fields,
)
assert(rb[0].front.includes('src="/media/flag.png"'), 'media src rewritten')
assert(rb[0].back.includes('hello'), 'back contains answer')

const clozeNote = parsed.notes.find((n) => n.mid === 1002)!
const clozeNt = parsed.noteTypes.get(1002)!
const rc = renderNote(
  { isCloze: true, fields: clozeNt.fields, templates: clozeNt.templates, css: clozeNt.css },
  clozeNote.fields,
)
assert(rc.length === 2, 'cloze note produces 2 cards')
assert(rc[0].front.includes('[...]') && rc[0].front.includes('Paris'), 'c1 hidden, c2 shown on front')
assert(rc[0].back.includes('France'), 'c1 revealed on back')

console.log('3) SM-2 scheduler')
let s = newCardState(0)
s = schedule(s, 3, 0) // Good on new -> learning step 2 (10m)
assert(s.state === 'learning', 'new+Good -> learning')
s = schedule(s, 3, 0) // Good -> graduate to review (1 day)
assert(s.state === 'review' && Math.round(s.interval) === 1, 'graduates to 1 day')
const beforeEase = s.ease_factor
s = schedule(s, 3, 0) // Good review -> interval grows
assert(s.interval > 1, `review interval grows to ${s.interval}`)
s = schedule(s, 1, 0) // Again -> lapse -> relearning, ease drops
assert(s.state === 'relearning' && s.ease_factor < beforeEase, 'lapse drops ease + relearning')

console.log('\nALL SMOKE TESTS PASSED ✅')
