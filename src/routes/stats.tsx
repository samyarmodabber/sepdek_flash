import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api, type Stats } from '../lib/api'

export const Route = createFileRoute('/stats')({ component: StatsPage })

const DAY = 86_400_000

function StatsPage() {
  const statsQ = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const s = statsQ.data

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:p-8">
      <h1 className="mb-6 text-2xl font-bold">Statistics</h1>
      {!s ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Total cards" value={s.totals.cards} />
            <Stat label="New" value={s.totals.new} color="var(--blue)" />
            <Stat label="Learning" value={s.totals.learning} color="var(--amber)" />
            <Stat label="Review" value={s.totals.review} color="var(--green)" />
            <Stat
              label="Retention"
              value={s.retention === null ? '—' : `${s.retention}%`}
              color="var(--accent)"
            />
          </div>

          <Panel title={`Review activity (${s.totals.reviews} total reviews)`}>
            <Heatmap data={s.heatmap} />
          </Panel>

          <Panel title="Due forecast (next 30 days)">
            <Forecast data={s.forecast} />
          </Panel>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="text-2xl font-bold" style={{ color: color ?? 'var(--text)' }}>
        {value}
      </div>
      <div className="text-xs text-[var(--muted)]">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="mb-4 text-sm font-semibold text-[var(--muted)]">{title}</h2>
      {children}
    </div>
  )
}

function heatColor(count: number, max: number): string {
  if (count <= 0) return 'var(--panel-2)'
  const t = Math.min(1, count / Math.max(1, max))
  // interpolate from faint to bright green
  const light = 18 + Math.round(t * 42) // 18%..60%
  return `hsl(142 70% ${light}%)`
}

function Heatmap({ data }: { data: Stats['heatmap'] }) {
  const WEEKS = 26
  const todayDay = Math.floor(Date.now() / DAY)
  const start = todayDay - WEEKS * 7 + 1
  const byDay = new Map(data.map((d) => [d.day, d.count]))
  const max = data.reduce((m, d) => Math.max(m, d.count), 0)

  const cols: number[][] = []
  for (let w = 0; w < WEEKS; w++) {
    const col: number[] = []
    for (let r = 0; r < 7; r++) col.push(start + w * 7 + r)
    cols.push(col)
  }

  return (
    <div className="flex gap-[3px] overflow-x-auto">
      {cols.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-[3px]">
          {col.map((day) => {
            const count = byDay.get(day) ?? 0
            const future = day > todayDay
            return (
              <div
                key={day}
                className="heat-cell"
                title={`${new Date(day * DAY).toISOString().slice(0, 10)}: ${count} reviews`}
                style={{
                  background: future ? 'transparent' : heatColor(count, max),
                  opacity: future ? 0.2 : 1,
                }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Forecast({ data }: { data: Stats['forecast'] }) {
  const byDay = new Map(data.map((d) => [d.day, d.count]))
  const days = Array.from({ length: 30 }, (_, i) => i)
  const max = Math.max(1, ...data.map((d) => d.count))
  return (
    <div className="flex h-40 items-end gap-[2px]">
      {days.map((d) => {
        const count = byDay.get(d) ?? 0
        return (
          <div
            key={d}
            className="flex-1 rounded-t bg-[var(--accent)]"
            title={`Day +${d}: ${count} cards`}
            style={{ height: `${(count / max) * 100}%`, minHeight: count ? 2 : 0 }}
          />
        )
      })}
    </div>
  )
}
