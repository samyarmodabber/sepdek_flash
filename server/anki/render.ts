// Renders Anki note templates into front/back HTML.
// Supports: {{Field}}, {{FrontSide}}, {{#Field}}..{{/Field}}, {{^Field}}..{{/Field}},
// filters ({{text:F}}, {{type:F}}, {{hint:F}}, {{furigana:F}} ...), and cloze deletions.

export type NoteType = {
  isCloze: boolean
  fields: string[]
  templates: { name: string; qfmt: string; afmt: string }[]
  css: string
}

// Rewrite media references (src/href) so they point at our media route.
export function rewriteMedia(html: string, prefix = '/media/'): string {
  return html.replace(
    /\b(src|href)\s*=\s*(["'])(.*?)\2/gi,
    (m, attr, q, url: string) => {
      if (/^(https?:|data:|\/|#|mailto:)/i.test(url)) return m
      return `${attr}=${q}${prefix}${encodeURI(url)}${q}`
    },
  )
}

function fieldMap(fields: string[], values: string[]): Map<string, string> {
  const map = new Map<string, string>()
  fields.forEach((f, i) => map.set(f, values[i] ?? ''))
  return map
}

// Strip the cloze markup for a given card ordinal: the active cloze becomes
// [...] (question) or the answer (answer side); other clozes show their answer.
function renderCloze(text: string, ord: number, reveal: boolean): string {
  // {{c1::answer}} or {{c1::answer::hint}}
  return text.replace(
    /\{\{c(\d+)::(.*?)(?:::(.*?))?\}\}/gs,
    (_m, numStr: string, answer: string, hint?: string) => {
      const num = parseInt(numStr, 10)
      if (num === ord + 1) {
        if (reveal) return `<span class="cloze">${answer}</span>`
        const placeholder = hint ? `[${hint}]` : '[...]'
        return `<span class="cloze">${placeholder}</span>`
      }
      // other clozes are always shown as their answer
      return answer
    },
  )
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '')
}

// Apply a single {{...}} replacement (non-section).
function applyField(
  token: string,
  fields: Map<string, string>,
  frontSide: string,
  ord: number,
  reveal: boolean,
): string {
  token = token.trim()
  if (token === 'FrontSide') return frontSide

  // filter chain: filter:filter:Field
  const parts = token.split(':')
  const name = parts.pop() as string
  const filters = parts

  const raw = fields.get(name)
  if (raw === undefined) return '' // unknown field -> empty
  let value: string = raw

  for (const f of filters) {
    if (f === 'text') value = stripHtml(value)
    else if (f === 'cloze') value = renderCloze(value, ord, reveal)
    else if (f === 'hint') {
      const id = `hint-${Math.abs(hashCode(value))}`
      value = `<a class="hint" href="#" onclick="document.getElementById('${id}').style.display='inline';this.style.display='none';return false;">show hint</a><span id="${id}" class="hint-content" style="display:none">${value}</span>`
    } else if (f === 'type') {
      value = '' // type-in-answer not supported in review view
    }
    // furigana / kanji / kana / unknown filters: leave value as-is
  }
  return value
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

// Process {{#Field}}...{{/Field}} and {{^Field}}...{{/Field}} sections recursively.
function processSections(tmpl: string, fields: Map<string, string>): string {
  const re = /\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/
  let prev: string
  do {
    prev = tmpl
    tmpl = tmpl.replace(re, (_m, kind: string, rawName: string, inner: string) => {
      const name = rawName.trim()
      const val = fields.get(name) ?? ''
      const truthy = val.trim() !== ''
      const show = kind === '#' ? truthy : !truthy
      return show ? inner : ''
    })
  } while (tmpl !== prev)
  return tmpl
}

function renderTemplate(
  tmpl: string,
  fields: Map<string, string>,
  frontSide: string,
  ord: number,
  reveal: boolean,
): string {
  let out = processSections(tmpl, fields)
  out = out.replace(/\{\{([^#^/][^}]*)\}\}/g, (_m, token: string) =>
    applyField(token, fields, frontSide, ord, reveal),
  )
  return out
}

export type RenderedCard = { ord: number; front: string; back: string }

// Render all cards produced by a note. `mediaPrefix` lets callers namespace media
// per user (e.g. "/media/<userId>/").
export function renderNote(
  nt: NoteType,
  values: string[],
  mediaPrefix = '/media/',
): RenderedCard[] {
  const fields = fieldMap(nt.fields, values)

  if (nt.isCloze) {
    const tmpl = nt.templates[0]
    // find all cloze numbers present across all fields
    const text = values.join(' ')
    const nums = new Set<number>()
    for (const m of text.matchAll(/\{\{c(\d+)::/g)) nums.add(parseInt(m[1], 10))
    if (nums.size === 0) nums.add(1)
    const cards: RenderedCard[] = []
    for (const num of [...nums].sort((a, b) => a - b)) {
      const ord = num - 1
      const front = renderTemplate(tmpl.qfmt, fields, '', ord, false)
      const back = renderTemplate(tmpl.afmt, fields, front, ord, true)
      cards.push({
        ord,
        front: rewriteMedia(front, mediaPrefix),
        back: rewriteMedia(back, mediaPrefix),
      })
    }
    return cards
  }

  return nt.templates.map((t, ord) => {
    const front = renderTemplate(t.qfmt, fields, '', ord, false)
    const back = renderTemplate(t.afmt, fields, front, ord, false)
    return {
      ord,
      front: rewriteMedia(front, mediaPrefix),
      back: rewriteMedia(back, mediaPrefix),
    }
  })
}

// Decide whether a non-cloze template actually generates a card for this note
// (Anki skips a card if the question side renders empty / has no fields).
export function templateProducesCard(
  nt: NoteType,
  values: string[],
  ord: number,
): boolean {
  if (nt.isCloze) return true
  const fields = fieldMap(nt.fields, values)
  const t = nt.templates[ord]
  if (!t) return false
  const front = stripHtml(renderTemplate(t.qfmt, fields, '', ord, false)).trim()
  return front.length > 0
}
