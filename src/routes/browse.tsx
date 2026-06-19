import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Plus, Trash2, Pencil, PauseCircle, PlayCircle, X } from 'lucide-react'
import { api, type CardRow } from '../lib/api'

export const Route = createFileRoute('/browse')({ component: Browse })

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function Browse() {
  const qc = useQueryClient()
  const [deckId, setDeckId] = useState<string | undefined>(undefined)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<CardRow | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const decksQ = useQuery({ queryKey: ['decks'], queryFn: api.decks })
  const cardsQ = useQuery({
    queryKey: ['cards', deckId, q],
    queryFn: () => api.cards({ deckId, q, limit: 200 }),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cards'] })
    qc.invalidateQueries({ queryKey: ['decks'] })
  }
  const delMut = useMutation({ mutationFn: api.deleteCard, onSuccess: invalidate })
  const suspendMut = useMutation({ mutationFn: api.suspendCard, onSuccess: invalidate })
  const bulkDelMut = useMutation({
    mutationFn: (ids: string[]) => api.deleteCards(ids),
    onSuccess: () => {
      setSelected(new Set())
      invalidate()
    },
  })

  const decks = decksQ.data ?? []
  const rows = cardsQ.data?.rows ?? []

  // selection limited to currently visible rows
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id)
  const allSelected = rows.length > 0 && selectedIds.length === rows.length

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))

  // anchor for shift-click range selection
  const [lastIndex, setLastIndex] = useState<number | null>(null)
  const selectRow = (index: number, id: string, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastIndex !== null) {
        const a = Math.min(lastIndex, index)
        const b = Math.max(lastIndex, index)
        const target = !prev.has(id) // new state of the clicked row, applied to range
        for (let i = a; i <= b; i++) {
          const rid = rows[i]?.id
          if (!rid) continue
          if (target) next.add(rid)
          else next.delete(rid)
        }
      } else {
        next.has(id) ? next.delete(id) : next.add(id)
      }
      return next
    })
    setLastIndex(index)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:p-8">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Browse</h1>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Plus size={16} /> Add card
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <select
          value={deckId ?? ''}
          onChange={(e) => setDeckId(e.target.value || undefined)}
          className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none"
        >
          <option value="">All decks</option>
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search front / back / tags…"
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="mb-2 flex h-7 items-center justify-between text-xs text-[var(--muted)]">
        <span>{cardsQ.data?.total ?? 0} cards</span>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text)]">{selectedIds.length} selected</span>
            <button
              onClick={() => setSelected(new Set())}
              className="rounded-md border border-[var(--border)] px-2 py-1 font-medium hover:bg-[var(--panel-2)]"
            >
              Clear
            </button>
            <button
              onClick={() => {
                if (confirm(`Delete ${selectedIds.length} selected card(s)?`))
                  bulkDelMut.mutate(selectedIds)
              }}
              disabled={bulkDelMut.isPending}
              className="flex items-center gap-1 rounded-md bg-[var(--red)] px-2 py-1 font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              <Trash2 size={13} /> Delete selected
            </button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-[var(--panel-2)] text-left text-xs uppercase text-[var(--muted)]">
            <tr>
              <th className="p-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  title="Select all"
                  className="cursor-pointer"
                />
              </th>
              <th className="p-3">Front</th>
              <th className="p-3">Back</th>
              <th className="p-3">Deck</th>
              <th className="p-3">State</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, index) => (
              <tr
                key={c.id}
                className={`border-t border-[var(--border)] hover:bg-[var(--panel)] ${
                  selected.has(c.id) ? 'bg-[var(--panel-2)]' : ''
                }`}
                style={{ opacity: c.suspended ? 0.45 : 1 }}
              >
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => {}}
                    onMouseDown={(e) => {
                      if (e.shiftKey) e.preventDefault() // avoid text selection
                    }}
                    onClick={(e) => selectRow(index, c.id, e.shiftKey)}
                    className="cursor-pointer"
                  />
                </td>
                <td className="max-w-[220px] truncate p-3">{stripHtml(c.front_html)}</td>
                <td className="max-w-[220px] truncate p-3 text-[var(--muted)]">
                  {stripHtml(c.back_html)}
                </td>
                <td className="p-3 text-xs text-[var(--muted)]">{c.deck_name}</td>
                <td className="p-3">
                  <StateBadge state={c.suspended ? 'suspended' : c.state} />
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-1">
                    <IconBtn title="Edit" onClick={() => setEditing(c)}>
                      <Pencil size={15} />
                    </IconBtn>
                    <IconBtn
                      title={c.suspended ? 'Unsuspend' : 'Suspend'}
                      onClick={() => suspendMut.mutate(c.id)}
                    >
                      {c.suspended ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
                    </IconBtn>
                    <IconBtn
                      title="Delete"
                      danger
                      onClick={() => {
                        if (confirm('Delete this card?')) delMut.mutate(c.id)
                      }}
                    >
                      <Trash2 size={15} />
                    </IconBtn>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[var(--muted)]">
                  No cards.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddCard decks={decks} onClose={() => setAdding(false)} onSaved={invalidate} />
      )}
      {editing && (
        <EditCard card={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      )}
    </div>
  )
}

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    new: 'var(--blue)',
    learning: 'var(--amber)',
    relearning: 'var(--amber)',
    review: 'var(--green)',
    suspended: 'var(--muted)',
  }
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color: map[state] ?? 'var(--muted)', border: `1px solid ${map[state] ?? 'var(--border)'}` }}
    >
      {state}
    </span>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--panel-2)] ${
        danger ? 'hover:text-[var(--red)]' : 'hover:text-[var(--text)]'
      }`}
    >
      {children}
    </button>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs uppercase text-[var(--muted)]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
    </label>
  )
}

function AddCard({
  decks,
  onClose,
  onSaved,
}: {
  decks: { id: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '')
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const mut = useMutation({
    mutationFn: () => api.createCard(deckId, front, back),
    onSuccess: () => {
      onSaved()
      setFront('')
      setBack('')
    },
  })
  return (
    <Modal title="Add card" onClose={onClose}>
      <label className="mb-3 block">
        <span className="mb-1 block text-xs uppercase text-[var(--muted)]">Deck</span>
        <select
          value={deckId}
          onChange={(e) => setDeckId(e.target.value)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none"
        >
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <Field label="Front" value={front} onChange={setFront} />
      <Field label="Back" value={back} onChange={setBack} />
      <button
        disabled={!front.trim() || !deckId || mut.isPending}
        onClick={() => mut.mutate()}
        className="w-full rounded-lg bg-[var(--accent)] py-2 font-semibold text-white disabled:opacity-50"
      >
        Save card
      </button>
    </Modal>
  )
}

function EditCard({
  card,
  onClose,
  onSaved,
}: {
  card: CardRow
  onClose: () => void
  onSaved: () => void
}) {
  const noteQ = useQuery({ queryKey: ['note', card.id], queryFn: () => api.note(card.id) })
  const [fields, setFields] = useState<string[]>([])
  const [tags, setTags] = useState(card.tags ?? '')
  const [loaded, setLoaded] = useState(false)
  if (noteQ.data && !loaded) {
    const data = noteQ.data
    setFields(data.fieldNames.map((_, i) => data.fields[i] ?? ''))
    setLoaded(true)
  }
  const setField = (i: number, v: string) =>
    setFields((prev) => prev.map((x, j) => (j === i ? v : x)))
  const mut = useMutation({
    mutationFn: () => api.updateCard(card.id, fields, tags),
    onSuccess: () => {
      onSaved()
      onClose()
    },
  })
  return (
    <Modal title="Edit card" onClose={onClose}>
      {!noteQ.data ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : (
        <>
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            {noteQ.data.fieldNames.map((name, i) => (
              <Field
                key={name + i}
                label={name}
                value={fields[i] ?? ''}
                onChange={(v) => setField(i, v)}
              />
            ))}
            <Field label="Tags (space-separated)" value={tags} onChange={setTags} />
          </div>
          <button
            disabled={mut.isPending}
            onClick={() => mut.mutate()}
            className="mt-2 w-full rounded-lg bg-[var(--accent)] py-2 font-semibold text-white disabled:opacity-50"
          >
            Save changes
          </button>
        </>
      )}
    </Modal>
  )
}
