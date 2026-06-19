import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  Upload,
  Plus,
  Trash2,
  Play,
  Loader2,
  ChevronRight,
  ChevronDown,
  Folder,
  FileText,
  FolderPlus,
  Pencil,
  Check,
  X,
  Settings2,
} from 'lucide-react'
import {
  api,
  type Deck,
  type ExponentialConfig,
  type ImportResult,
  type LeitnerConfig,
  type Scheduler,
  type SchedulerConfig,
  type TemplateSelection,
} from '../lib/api'

export const Route = createFileRoute('/')({ component: Decks })

type DeckNode = Deck & { children: DeckNode[] }

function buildTree(decks: Deck[]): DeckNode[] {
  const byId = new Map<string, DeckNode>()
  decks.forEach((d) => byId.set(d.id, { ...d, children: [] }))
  const roots: DeckNode[] = []
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  const sortRec = (nodes: DeckNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

type VisibleRow = { node: DeckNode; depth: number; hasChildren: boolean }

function flatten(
  nodes: DeckNode[],
  depth: number,
  collapsed: Set<string>,
  out: VisibleRow[],
) {
  for (const n of nodes) {
    const hasChildren = n.children.length > 0
    out.push({ node: n, depth, hasChildren })
    if (hasChildren && !collapsed.has(n.id)) flatten(n.children, depth + 1, collapsed, out)
  }
}

function Decks() {
  const qc = useQueryClient()
  const decksQ = useQuery({ queryKey: ['decks'], queryFn: api.decks })
  const fileRef = useRef<HTMLInputElement>(null)
  const [newName, setNewName] = useState('')
  const [importMsg, setImportMsg] = useState<ImportResult | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [newParentId, setNewParentId] = useState('')
  const [settingsDeck, setSettingsDeck] = useState<Deck | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const importMut = useMutation({
    mutationFn: ({
      file,
      targetDeckId,
      templateSelection,
    }: {
      file: File
      targetDeckId?: string
      templateSelection?: TemplateSelection
    }) => api.importApkg(file, targetDeckId, templateSelection),
    onSuccess: (res) => {
      setImportMsg(res)
      setPendingFile(null)
      qc.invalidateQueries({ queryKey: ['decks'] })
    },
  })
  const createMut = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      api.createDeck(name, parentId),
    onSuccess: () => {
      setNewName('')
      setNewParentId('')
      qc.invalidateQueries({ queryKey: ['decks'] })
    },
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteDeck(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  })
  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameDeck(id, name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateDeck>[1] }) =>
      api.updateDeck(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decks'] })
      // Button intervals on the study screen are derived from the deck's
      // scheduler, so a model change must refresh any cached study session.
      qc.invalidateQueries({ queryKey: ['study'] })
    },
  })

  const decks = decksQ.data ?? []

  // Collapse every deck that has subdecks by default, once decks first load.
  // A ref guards it so refetches don't undo the user's manual expand/collapse.
  const collapseInitialized = useRef(false)
  useEffect(() => {
    if (collapseInitialized.current || decks.length === 0) return
    const parents = new Set<string>()
    for (const d of decks) if (d.parent_id) parents.add(d.parent_id)
    setCollapsed(parents)
    collapseInitialized.current = true
  }, [decks])

  const labels = deckLabels(decks)
  const tree = buildTree(decks)
  const rows: VisibleRow[] = []
  flatten(tree, 0, collapsed, rows)

  const addDeck = () => {
    if (newName.trim()) createMut.mutate({ name: newName.trim(), parentId: newParentId || undefined })
  }
  const startSubdeck = (parentId: string) => {
    setNewParentId(parentId)
    nameRef.current?.focus()
  }

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Decks</h1>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".apkg,.colpkg"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) setPendingFile(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importMut.isPending}
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {importMut.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            Import .apkg
          </button>
        </div>
      </div>

      {importMut.isError && (
        <Banner kind="error">Import failed: {(importMut.error as Error).message}</Banner>
      )}
      {importMsg && (
        <Banner kind="ok">
          Imported {importMsg.cards} cards / {importMsg.notes} notes ·{' '}
          {importMsg.decks === 0
            ? 'added to existing deck'
            : importMsg.decks === 1
              ? '1 new deck'
              : `${importMsg.decks} new decks (including subdecks)`}{' '}
          · {importMsg.media} media · format {importMsg.format}.
        </Banner>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <input
          ref={nameRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addDeck()}
          placeholder="New deck name…"
          className="min-w-[160px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <select
          value={newParentId}
          onChange={(e) => setNewParentId(e.target.value)}
          title="Parent deck"
          className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="">Top level</option>
          {labels.map((d) => (
            <option key={d.id} value={d.id}>
              under: {d.label}
            </option>
          ))}
        </select>
        <button
          onClick={addDeck}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-sm font-medium hover:bg-[var(--panel-2)]"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {decksQ.isLoading ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : decks.length === 0 ? (
        <Empty />
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          {rows.map(({ node, depth, hasChildren }) => (
            <DeckRow
              key={node.id}
              node={node}
              depth={depth}
              hasChildren={hasChildren}
              collapsed={collapsed.has(node.id)}
              onToggle={() => toggle(node.id)}
              onAddSub={() => startSubdeck(node.id)}
              onRename={(name) => renameMut.mutate({ id: node.id, name })}
              onOpenSettings={() => setSettingsDeck(node)}
              onDelete={() => {
                const msg = hasChildren
                  ? `Delete "${node.name}" and all its subdecks and cards?`
                  : `Delete deck "${node.name}" and all its cards?`
                if (confirm(msg)) deleteMut.mutate(node.id)
              }}
            />
          ))}
        </div>
      )}

      {pendingFile && (
        <ImportOptionsModal
          file={pendingFile}
          decks={decks}
          pending={importMut.isPending}
          onCancel={() => setPendingFile(null)}
          onConfirm={(targetDeckId, templateSelection) =>
            importMut.mutate({ file: pendingFile, targetDeckId, templateSelection })
          }
        />
      )}

      {settingsDeck && (
        <DeckSettingsModal
          deck={settingsDeck}
          pending={updateMut.isPending}
          onCancel={() => setSettingsDeck(null)}
          onSave={(patch) =>
            updateMut.mutate(
              { id: settingsDeck.id, patch },
              { onSuccess: () => setSettingsDeck(null) },
            )
          }
        />
      )}
    </div>
  )
}

const DEFAULT_EXP: ExponentialConfig = { baseDays: 1, hard: 1.5, good: 2.5, easy: 4 }
const DEFAULT_LEITNER: LeitnerConfig = { boxes: [1, 3, 7, 14, 30] }

const SCHEDULERS: { value: Scheduler; label: string; blurb: string }[] = [
  {
    value: 'anki',
    label: 'Anki (SM-2)',
    blurb: 'Automatic intervals from the SM-2 algorithm with learning steps. No manual periods.',
  },
  {
    value: 'exponential',
    label: 'Exponential',
    blurb: 'Each button multiplies the current interval. Again resets to the base interval.',
  },
  {
    value: 'leitner',
    label: 'Leitner',
    blurb: 'Fixed boxes. Again→box 1, Hard→same box, Good→next box, Easy→skip a box.',
  },
]

function schedulerLabel(s: Scheduler): string {
  return s === 'exponential' ? 'Exponential' : s === 'leitner' ? 'Leitner' : 'Anki'
}

function DeckSettingsModal({
  deck,
  pending,
  onCancel,
  onSave,
}: {
  deck: Deck
  pending: boolean
  onCancel: () => void
  onSave: (patch: {
    newPerDay: number
    scheduler: Scheduler
    schedulerConfig: SchedulerConfig
  }) => void
}) {
  const [newPerDay, setNewPerDay] = useState(String(deck.new_per_day))
  const [mode, setMode] = useState<Scheduler>(deck.scheduler)

  const initExp =
    deck.scheduler === 'exponential' && deck.scheduler_config
      ? { ...DEFAULT_EXP, ...(deck.scheduler_config as ExponentialConfig) }
      : DEFAULT_EXP
  const [exp, setExp] = useState<Record<keyof ExponentialConfig, string>>({
    baseDays: String(initExp.baseDays),
    hard: String(initExp.hard),
    good: String(initExp.good),
    easy: String(initExp.easy),
  })

  const initBoxes =
    deck.scheduler === 'leitner' && deck.scheduler_config
      ? (deck.scheduler_config as LeitnerConfig).boxes
      : DEFAULT_LEITNER.boxes
  const [boxes, setBoxes] = useState(initBoxes.join(', '))

  const setExpField = (k: keyof ExponentialConfig, v: string) =>
    setExp((prev) => ({ ...prev, [k]: v }))

  const save = () => {
    const n = Math.max(0, Math.round(Number(newPerDay) || 0))
    let schedulerConfig: SchedulerConfig = null
    if (mode === 'exponential') {
      const num = (v: string, fallback: number) => {
        const x = Number(v)
        return Number.isFinite(x) && x > 0 ? x : fallback
      }
      schedulerConfig = {
        baseDays: Math.max(1, Math.round(num(exp.baseDays, DEFAULT_EXP.baseDays))),
        hard: num(exp.hard, DEFAULT_EXP.hard),
        good: num(exp.good, DEFAULT_EXP.good),
        easy: num(exp.easy, DEFAULT_EXP.easy),
      }
    } else if (mode === 'leitner') {
      const arr = boxes
        .split(',')
        .map((x) => Math.round(Number(x.trim())))
        .filter((x) => Number.isFinite(x) && x > 0)
      schedulerConfig = { boxes: arr.length ? arr : [...DEFAULT_LEITNER.boxes] }
    }
    onSave({ newPerDay: n, scheduler: mode, schedulerConfig })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={pending ? undefined : onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold">Deck settings</h2>
        <p className="mb-5 truncate text-xs text-[var(--muted)]">{deck.name}</p>

        <div className="-mx-1 space-y-5 overflow-y-auto px-1">
          {/* daily new cards */}
          <label className="block">
            <span className="mb-1 block text-sm font-medium">New cards / day</span>
            <input
              type="number"
              min={0}
              value={newPerDay}
              onChange={(e) => setNewPerDay(e.target.value)}
              className="w-32 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          {/* scheduling mode */}
          <div>
            <span className="mb-2 block text-sm font-medium">Scheduling mode</span>
            <div className="space-y-2">
              {SCHEDULERS.map((s) => (
                <label
                  key={s.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                    mode === s.value
                      ? 'border-[var(--accent)] bg-[var(--panel-2)]'
                      : 'border-[var(--border)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="scheduler"
                    checked={mode === s.value}
                    onChange={() => setMode(s.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-[var(--muted)]">{s.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* per-mode config */}
          {mode === 'exponential' && (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="mb-2 text-sm font-medium">Button intervals</p>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Base interval (days)" value={exp.baseDays} onChange={(v) => setExpField('baseDays', v)} />
                <NumField label="Hard ×" value={exp.hard} onChange={(v) => setExpField('hard', v)} step="0.1" />
                <NumField label="Good ×" value={exp.good} onChange={(v) => setExpField('good', v)} step="0.1" />
                <NumField label="Easy ×" value={exp.easy} onChange={(v) => setExpField('easy', v)} step="0.1" />
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Again resets the interval to the base. The others multiply the current interval.
              </p>
            </div>
          )}
          {mode === 'leitner' && (
            <div className="rounded-lg border border-[var(--border)] p-3">
              <p className="mb-2 text-sm font-medium">Box intervals (days)</p>
              <input
                value={boxes}
                onChange={(e) => setBoxes(e.target.value)}
                placeholder="1, 3, 7, 14, 30"
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-2 text-xs text-[var(--muted)]">
                Comma-separated, ascending. A card in box <em>n</em> becomes due after that many days.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--panel-2)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={pending}
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {pending && <Loader2 size={16} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--muted)]">{label}</span>
      <input
        type="number"
        min={0}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
      />
    </label>
  )
}

function deckLabels(decks: Deck[]): { id: string; label: string }[] {
  const byId = new Map(decks.map((d) => [d.id, d]))
  const full = (d: Deck): string => {
    const parent = d.parent_id ? byId.get(d.parent_id) : undefined
    return parent ? `${full(parent)} :: ${d.name}` : d.name
  }
  return decks
    .map((d) => ({ id: d.id, label: full(d) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function ImportOptionsModal({
  file,
  decks,
  pending,
  onCancel,
  onConfirm,
}: {
  file: File
  decks: Deck[]
  pending: boolean
  onCancel: () => void
  onConfirm: (targetDeckId?: string, templateSelection?: TemplateSelection) => void
}) {
  const labels = deckLabels(decks)
  const hasDecks = labels.length > 0
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [deckId, setDeckId] = useState(labels[0]?.id ?? '')

  // Step 1: inspect the file so the user can pick which card templates to import.
  const inspectQ = useQuery({
    queryKey: ['inspect', file.name, file.size, file.lastModified],
    queryFn: () => api.inspectApkg(file),
    staleTime: Infinity,
    retry: false,
  })

  // mid -> selected template ordinals. Only note types whose templates produce
  // more than one card per note are offered as choices; everything else (and all
  // cloze note types) imports in full.
  const choosable = (inspectQ.data?.noteTypes ?? []).filter(
    (nt) => !nt.isCloze && nt.templates.length > 1,
  )
  const [sel, setSel] = useState<Record<number, number[]>>({})
  useEffect(() => {
    if (!inspectQ.data) return
    const init: Record<number, number[]> = {}
    for (const nt of inspectQ.data.noteTypes) {
      if (!nt.isCloze) init[nt.mid] = nt.templates.map((t) => t.ord)
    }
    setSel(init)
  }, [inspectQ.data])

  const toggle = (mid: number, ord: number) =>
    setSel((prev) => {
      const cur = prev[mid] ?? []
      const next = cur.includes(ord) ? cur.filter((o) => o !== ord) : [...cur, ord]
      return { ...prev, [mid]: next }
    })

  // Cards that will actually be imported, given the current selection.
  const selectedCards = (inspectQ.data?.noteTypes ?? []).reduce((sum, nt) => {
    if (nt.isCloze) return sum + nt.templates.reduce((s, t) => s + t.cardCount, 0)
    const allowed = sel[nt.mid] ?? nt.templates.map((t) => t.ord)
    return sum + nt.templates.reduce((s, t) => (allowed.includes(t.ord) ? s + t.cardCount : s), 0)
  }, 0)

  const confirm = () => {
    // Only send a selection when the user actually narrowed something; otherwise
    // omit it so the backend imports every template.
    const narrowed = choosable.some((nt) => (sel[nt.mid] ?? []).length < nt.templates.length)
    const templateSelection = narrowed ? sel : undefined
    onConfirm(mode === 'existing' ? deckId : undefined, templateSelection)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={pending ? undefined : onCancel}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 text-lg font-semibold">Import deck</h2>
        <p className="mb-5 truncate text-xs text-[var(--muted)]">{file.name}</p>

        <div className="-mx-1 space-y-2 overflow-y-auto px-1">
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
              mode === 'new' ? 'border-[var(--accent)] bg-[var(--panel-2)]' : 'border-[var(--border)]'
            }`}
          >
            <input
              type="radio"
              name="import-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium">Create new decks</span>
              <span className="block text-xs text-[var(--muted)]">
                Keep the file's own deck and subdeck structure.
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-3 rounded-lg border p-3 transition ${
              !hasDecks
                ? 'cursor-not-allowed opacity-50'
                : 'cursor-pointer'
            } ${
              mode === 'existing'
                ? 'border-[var(--accent)] bg-[var(--panel-2)]'
                : 'border-[var(--border)]'
            }`}
          >
            <input
              type="radio"
              name="import-mode"
              disabled={!hasDecks}
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium">Add to an existing deck</span>
              <span className="block text-xs text-[var(--muted)]">
                Put all imported cards into one deck you already have.
              </span>
              {mode === 'existing' && hasDecks && (
                <select
                  value={deckId}
                  onChange={(e) => setDeckId(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                >
                  {labels.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
            </span>
          </label>

          {/* Card templates — only note types that make more than one card per note */}
          {inspectQ.isLoading && (
            <div className="flex items-center gap-2 px-1 py-2 text-xs text-[var(--muted)]">
              <Loader2 size={14} className="animate-spin" /> Reading file…
            </div>
          )}
          {inspectQ.isError && (
            <p className="px-1 py-2 text-xs text-red-400">
              Couldn't read the file's card templates; all cards will be imported.
            </p>
          )}
          {choosable.length > 0 && (
            <div className="mt-2 rounded-lg border border-[var(--border)] p-3">
              <p className="text-sm font-medium">Card templates</p>
              <p className="mb-2 text-xs text-[var(--muted)]">
                Some note types create more than one card per note. Uncheck the ones
                you don't want.
              </p>
              <div className="space-y-3">
                {choosable.map((nt) => (
                  <div key={nt.mid}>
                    <p className="truncate text-xs font-medium text-[var(--muted)]">
                      {nt.name} · {nt.noteCount} notes
                    </p>
                    <div className="mt-1 space-y-1">
                      {nt.templates.map((t) => {
                        const checked = (sel[nt.mid] ?? []).includes(t.ord)
                        return (
                          <label
                            key={t.ord}
                            className="flex cursor-pointer items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(nt.mid, t.ord)}
                            />
                            <span className="flex-1 truncate">{t.name || `Card ${t.ord + 1}`}</span>
                            <span className="text-xs text-[var(--muted)]">{t.cardCount}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--muted)]">
            {inspectQ.data ? `${selectedCards} cards` : ''}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              disabled={pending}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-[var(--panel-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={
                pending ||
                (mode === 'existing' && !deckId) ||
                (!!inspectQ.data && selectedCards === 0)
              }
              className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {pending && <Loader2 size={16} className="animate-spin" />}
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DeckRow({
  node,
  depth,
  hasChildren,
  collapsed,
  onToggle,
  onAddSub,
  onRename,
  onOpenSettings,
  onDelete,
}: {
  node: DeckNode
  depth: number
  hasChildren: boolean
  collapsed: boolean
  onToggle: () => void
  onAddSub: () => void
  onRename: (name: string) => void
  onOpenSettings: () => void
  onDelete: () => void
}) {
  const ready = node.counts.due + node.counts.learning + node.counts.new
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(node.name)

  const startEdit = () => {
    setDraft(node.name)
    setEditing(true)
  }
  const save = () => {
    const name = draft.trim()
    if (name && name !== node.name) onRename(name)
    setEditing(false)
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--panel)] px-3 py-3 last:border-b-0 hover:bg-[var(--panel-2)]">
      {/* indentation + chevron */}
      <div
        className="flex items-center"
        style={{ paddingLeft: Math.min(depth, 4) * 16 }}
      >
        {hasChildren ? (
          <button
            onClick={onToggle}
            className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--text)]"
            title={collapsed ? 'Expand subdecks' : 'Collapse subdecks'}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </button>
        ) : (
          <span className="inline-block w-[22px]" />
        )}
      </div>

      <div className="shrink-0 text-[var(--muted)]">
        {hasChildren ? <Folder size={16} /> : <FileText size={16} />}
      </div>

      <div className="min-w-[140px] flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') setEditing(false)
              }}
              className="min-w-0 flex-1 rounded-md border border-[var(--accent)] bg-[var(--panel-2)] px-2 py-1 text-sm font-semibold outline-none"
            />
          ) : (
            <span className="truncate font-semibold">{node.name}</span>
          )}
          {hasChildren && !editing && (
            <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
              {node.children.length} subdeck{node.children.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
          <Count n={node.counts.new} color="var(--blue)" label="new" />
          <Count n={node.counts.learning} color="var(--amber)" label="learn" />
          <Count n={node.counts.due} color="var(--green)" label="due" />
          <span className="text-[var(--muted)]">
            {node.counts.total} card{node.counts.total === 1 ? '' : 's'}
            {hasChildren ? ' (incl. subdecks)' : ''}
          </span>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 rounded text-[var(--muted)] hover:text-[var(--accent)]"
            title="Deck settings"
          >
            <Settings2 size={12} /> {node.new_per_day}/day · {schedulerLabel(node.scheduler)}
          </button>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1">
      {editing ? (
        <>
          <button
            onClick={save}
            className="rounded-lg p-2 text-[var(--green)] hover:bg-[var(--panel)]"
            title="Save name"
          >
            <Check size={16} />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
            title="Cancel"
          >
            <X size={16} />
          </button>
        </>
      ) : (
        <>
          <Link
            to="/study/$deckId"
            params={{ deckId: String(node.id) }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
              ready > 0
                ? 'bg-[var(--green)] text-white hover:opacity-90'
                : 'cursor-default bg-[var(--panel-2)] text-[var(--muted)]'
            }`}
          >
            <Play size={15} /> {ready > 0 ? `Study (${ready})` : 'Done'}
          </Link>
          <button
            onClick={onOpenSettings}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--accent)]"
            title="Deck settings"
          >
            <Settings2 size={16} />
          </button>
          <button
            onClick={startEdit}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
            title="Rename deck"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={onAddSub}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--accent)]"
            title="Add subdeck"
          >
            <FolderPlus size={16} />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--panel)] hover:text-[var(--red)]"
            title="Delete deck"
          >
            <Trash2 size={16} />
          </button>
        </>
      )}
      </div>
    </div>
  )
}

function Count({ n, color, label }: { n: number; color: string; label: string }) {
  return (
    <span style={{ color: n > 0 ? color : 'var(--muted)' }} title={label}>
      {n} {label}
    </span>
  )
}

function Banner({ kind, children }: { kind: 'ok' | 'error'; children: React.ReactNode }) {
  return (
    <div
      className="mb-4 rounded-lg border px-4 py-3 text-sm"
      style={{
        borderColor: kind === 'ok' ? 'var(--green)' : 'var(--red)',
        background: kind === 'ok' ? 'rgba(46,110,99,0.10)' : 'rgba(178,58,46,0.10)',
        color: kind === 'ok' ? 'var(--teal)' : 'var(--ledger)',
      }}
    >
      {children}
    </div>
  )
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-12 text-center text-[var(--muted)]">
      <p className="mb-1 text-lg">No decks yet</p>
      <p className="text-sm">
        Import an Anki <code>.apkg</code> file or create a deck to begin.
      </p>
    </div>
  )
}
