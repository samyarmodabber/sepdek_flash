import { createFileRoute, Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, PartyPopper } from 'lucide-react'
import { api, type Preview } from '../lib/api'

export const Route = createFileRoute('/study/$deckId')({ component: Study })

function Study() {
  const { deckId } = useParams({ from: '/study/$deckId' })
  const id = deckId
  const qc = useQueryClient()
  const [revealed, setRevealed] = useState(false)
  const shownAt = useRef(Date.now())

  const studyQ = useQuery({
    queryKey: ['study', id],
    queryFn: () => api.nextCard(id),
    refetchOnMount: 'always',
  })

  useEffect(() => {
    setRevealed(false)
    shownAt.current = Date.now()
  }, [studyQ.data?.card?.id])

  const answerMut = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: string; rating: number }) =>
      api.answer(cardId, rating, Date.now() - shownAt.current),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['study', id] })
      qc.invalidateQueries({ queryKey: ['decks'] })
    },
  })

  const card = studyQ.data?.card
  const previews = studyQ.data?.previews ?? []
  const counts = studyQ.data?.counts

  const rate = useCallback(
    (rating: number) => {
      if (!card || answerMut.isPending) return
      answerMut.mutate({ cardId: card.id, rating })
    },
    [card, answerMut],
  )

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault()
        setRevealed((r) => !r)
      } else if (!revealed && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault()
        setRevealed(true)
      } else if (revealed && ['1', '2', '3', '4'].includes(e.key)) {
        rate(Number(e.key))
      } else if (revealed && e.code === 'Space') {
        e.preventDefault()
        setRevealed(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, revealed, rate])

  // map a rating (1-4) to its answer-bar style class
  const ratingClass = (rating: number) =>
    rating === 1 ? 'again' : rating === 2 ? 'hard' : rating === 3 ? 'good' : 'easy'

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-5 sm:px-6 sm:py-8">
      <div className="mb-4 flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-[var(--muted)] hover:text-[var(--ink)]"
        >
          <ArrowLeft size={14} /> Decks
        </Link>
        {counts && (
          <div className="ticker !mb-0">
            <span>
              new <b style={{ color: 'var(--blue)' }}>{counts.new}</b>
            </span>
            <span>
              learn <b style={{ color: 'var(--gold)' }}>{counts.learning}</b>
            </span>
            <span className="t-good">
              due <b>{counts.due}</b>
            </span>
          </div>
        )}
      </div>

      {studyQ.isLoading ? (
        <Center>Loading…</Center>
      ) : !card ? (
        <Done />
      ) : (
        <>
          {card.css && <style dangerouslySetInnerHTML={{ __html: scopeCss(card.css) }} />}
          <div className="flex flex-1 flex-col justify-center">
            <div className="study-stage">
              <div
                className={`index-card${revealed ? ' flipped' : ''}`}
                role="button"
                aria-label="flip card"
                tabIndex={0}
                onClick={() => setRevealed((r) => !r)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setRevealed((r) => !r)
                }}
              >
                <div className="face front card-scope">
                  <span className="card-side-label">prompt</span>
                  <div
                    className="card-content"
                    dangerouslySetInnerHTML={{ __html: card.front }}
                  />
                  <div className="flip-hint">tap or press space to flip</div>
                </div>
                <div className="face back card-scope">
                  <span className="card-side-label">answer</span>
                  <div
                    className="card-content"
                    dangerouslySetInnerHTML={{ __html: card.back }}
                  />
                  {/* <div className="flip-hint">rate how well you knew it</div> */}
                </div>
              </div>
            </div>

            {!revealed ? (
              <div className="answer-bar">
                <button className="easy" onClick={() => setRevealed(true)}>
                  Show answer
                  <span className="ivl">space</span>
                </button>
              </div>
            ) : (
              <div className="answer-bar">
                {previews.map((p: Preview) => (
                  <button
                    key={p.rating}
                    className={ratingClass(p.rating)}
                    onClick={() => rate(p.rating)}
                    disabled={answerMut.isPending}
                  >
                    {p.label}
                    <span className="ivl">
                      {p.display} · {p.rating}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// scope card CSS to .card-scope so deck styles don't leak into the whole app
function scopeCss(css: string): string {
  return css.replace(/(^|\})\s*([^{}@]+)\s*\{/g, (_m, brace, sel) => {
    const scoped = sel
      .split(',')
      .map((s: string) => `.card-scope ${s.trim()}`)
      .join(', ')
    return `${brace} ${scoped} {`
  })
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-[var(--muted)]">
      {children}
    </div>
  )
}

function Done() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <PartyPopper size={44} className="text-[var(--teal)]" />
      <h2 className="text-3xl">Session complete ✓</h2>
      <p className="text-[var(--muted)]">No more cards due in this deck.</p>
      <Link
        to="/"
        className="mt-2 rounded-[var(--radius)] bg-[var(--accent)] px-5 py-2 font-mono text-xs uppercase tracking-wider text-white transition hover:bg-[var(--ledger-2)]"
      >
        Back to decks
      </Link>
    </div>
  )
}
