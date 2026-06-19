// Spaced-repetition scheduler. Three selectable modes per deck:
//   'anki'        — SM-2 with Anki-style learning steps (the original behaviour)
//   'exponential' — interval grows by a per-button multiplier each review
//   'leitner'     — fixed boxes; buttons move the card between boxes
// Ratings: 1=Again, 2=Hard, 3=Good, 4=Easy

export type Rating = 1 | 2 | 3 | 4

export type Scheduler = 'anki' | 'exponential' | 'leitner'

export type SrsState = {
  state: 'new' | 'learning' | 'review' | 'relearning'
  due: number // ms epoch
  interval: number // days
  ease_factor: number
  reps: number
  lapses: number
  learning_step: number
  box: number // Leitner box index (unused by other modes)
}

// ---- per-mode config (persisted as Deck.schedulerConfig JSON) -----------------
export type ExponentialConfig = {
  baseDays: number // starting interval for a new card / Again reset
  hard: number // interval multipliers
  good: number
  easy: number
}
export type LeitnerConfig = {
  boxes: number[] // day interval for each box, ascending
}

export const DEFAULT_EXPONENTIAL: ExponentialConfig = {
  baseDays: 1,
  hard: 1.5,
  good: 2.5,
  easy: 4,
}
export const DEFAULT_LEITNER: LeitnerConfig = { boxes: [1, 3, 7, 14, 30] }

const posNum = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Coerce whatever was stored in the DB (possibly partial/garbage) into a valid
// config, falling back to the defaults field-by-field.
export function normalizeExponential(c: unknown): ExponentialConfig {
  const o = (c ?? {}) as Partial<ExponentialConfig>
  return {
    baseDays: posNum(o.baseDays, DEFAULT_EXPONENTIAL.baseDays),
    hard: posNum(o.hard, DEFAULT_EXPONENTIAL.hard),
    good: posNum(o.good, DEFAULT_EXPONENTIAL.good),
    easy: posNum(o.easy, DEFAULT_EXPONENTIAL.easy),
  }
}
export function normalizeLeitner(c: unknown): LeitnerConfig {
  const o = (c ?? {}) as Partial<LeitnerConfig>
  const boxes = Array.isArray(o.boxes)
    ? o.boxes.map((d) => Math.max(1, Math.round(posNum(d, 1))))
    : []
  return { boxes: boxes.length ? boxes : [...DEFAULT_LEITNER.boxes] }
}

const DAY = 86_400_000
const MIN = 60_000

// Learning/relearning steps in minutes (Anki defaults: 1m, 10m).
const LEARNING_STEPS = [1, 10]
const RELEARNING_STEPS = [10]
const GRADUATING_INTERVAL = 1 // days
const EASY_INTERVAL = 4 // days
const MIN_EASE = 1.3
const EASY_BONUS = 1.3
const HARD_FACTOR = 1.2
const LAPSE_MULT = 0.5 // new interval = old * this, when you lapse a review card

export type SchedulePreview = {
  rating: Rating
  label: string
  // human friendly next interval, e.g. "1 min", "10 min", "1 d", "4 d"
  display: string
}

function fmt(ms: number): string {
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`
  if (ms < DAY) return `${Math.round(ms / (60 * MIN))} h`
  const days = ms / DAY
  if (days < 30) return `${Math.round(days)} d`
  if (days < 365) return `${(days / 30).toFixed(1)} mo`
  return `${(days / 365).toFixed(1)} y`
}

// Pure function: given current state + rating + now, return the next state.
// `scheduler` selects the mode; `config` is that mode's settings (ignored by anki).
export function schedule(
  prev: SrsState,
  rating: Rating,
  now: number,
  scheduler: Scheduler = 'anki',
  config?: unknown,
): SrsState {
  if (scheduler === 'exponential') {
    return scheduleExponential({ ...prev }, rating, now, normalizeExponential(config))
  }
  if (scheduler === 'leitner') {
    return scheduleLeitner({ ...prev }, rating, now, normalizeLeitner(config))
  }

  const s: SrsState = { ...prev }
  if (s.state === 'new' || s.state === 'learning') {
    return scheduleLearning(s, rating, now, LEARNING_STEPS, false)
  }
  if (s.state === 'relearning') {
    return scheduleLearning(s, rating, now, RELEARNING_STEPS, true)
  }
  // review
  return scheduleReview(s, rating, now)
}

// Exponential: each non-Again button multiplies the current interval; Again
// resets it to the base. No intra-day learning steps — everything is in days.
function scheduleExponential(
  s: SrsState,
  rating: Rating,
  now: number,
  cfg: ExponentialConfig,
): SrsState {
  s.reps += 1
  const base = s.interval > 0 ? s.interval : cfg.baseDays
  let interval: number
  if (rating === 1) {
    s.lapses += 1
    interval = cfg.baseDays
  } else if (rating === 2) {
    interval = base * cfg.hard
  } else if (rating === 3) {
    interval = base * cfg.good
  } else {
    interval = base * cfg.easy
  }
  s.interval = Math.max(1, Math.round(interval))
  s.state = 'review'
  s.learning_step = 0
  s.due = now + s.interval * DAY
  return s
}

// Leitner: a ladder of boxes with fixed intervals. Again drops to box 0, Hard
// stays, Good advances one box, Easy jumps two.
function scheduleLeitner(
  s: SrsState,
  rating: Rating,
  now: number,
  cfg: LeitnerConfig,
): SrsState {
  s.reps += 1
  const maxBox = cfg.boxes.length - 1
  let box = Math.min(Math.max(0, s.box), maxBox)
  if (rating === 1) {
    s.lapses += 1
    box = 0
  } else if (rating === 3) {
    box = Math.min(maxBox, box + 1)
  } else if (rating === 4) {
    box = Math.min(maxBox, box + 2)
  } // rating === 2 (Hard): stay in the same box
  s.box = box
  s.interval = cfg.boxes[box]
  s.state = 'review'
  s.learning_step = 0
  s.due = now + cfg.boxes[box] * DAY
  return s
}

function scheduleLearning(
  s: SrsState,
  rating: Rating,
  now: number,
  steps: number[],
  isRelearn: boolean,
): SrsState {
  s.state = isRelearn ? 'relearning' : 'learning'

  if (rating === 1) {
    // Again -> back to first step
    s.learning_step = 0
    s.due = now + steps[0] * MIN
    return s
  }
  if (rating === 4) {
    // Easy -> graduate immediately
    return graduate(s, now, EASY_INTERVAL)
  }
  // Hard (2): repeat current step (slightly delayed). Good (3): advance.
  let step = s.learning_step
  if (rating === 3) step += 1

  if (step >= steps.length) {
    // graduate
    return graduate(s, now, isRelearn ? Math.max(1, Math.round(s.interval)) || GRADUATING_INTERVAL : GRADUATING_INTERVAL)
  }
  s.learning_step = step
  const mins = rating === 2 && step === s.learning_step ? steps[step] * 1.5 : steps[step]
  s.due = now + mins * MIN
  return s
}

function graduate(s: SrsState, now: number, intervalDays: number): SrsState {
  s.state = 'review'
  s.learning_step = 0
  s.interval = intervalDays
  s.reps += 1
  s.due = now + intervalDays * DAY
  if (s.ease_factor < MIN_EASE) s.ease_factor = 2.5
  return s
}

function scheduleReview(s: SrsState, rating: Rating, now: number): SrsState {
  s.reps += 1

  if (rating === 1) {
    // lapse
    s.lapses += 1
    s.ease_factor = Math.max(MIN_EASE, s.ease_factor - 0.2)
    s.interval = Math.max(1, s.interval * LAPSE_MULT)
    s.state = 'relearning'
    s.learning_step = 0
    s.due = now + RELEARNING_STEPS[0] * MIN
    return s
  }

  let factor = s.ease_factor
  let interval: number

  if (rating === 2) {
    factor = Math.max(MIN_EASE, factor - 0.15)
    interval = s.interval * HARD_FACTOR
  } else if (rating === 3) {
    interval = s.interval * factor
  } else {
    factor = factor + 0.15
    interval = s.interval * factor * EASY_BONUS
  }

  interval = Math.max(s.interval + 1, Math.round(interval))
  s.ease_factor = factor
  s.interval = interval
  s.state = 'review'
  s.due = now + interval * DAY
  return s
}

// Compute the "next interval" preview labels for all 4 buttons without mutating.
export function previews(
  prev: SrsState,
  now: number,
  scheduler: Scheduler = 'anki',
  config?: unknown,
): SchedulePreview[] {
  const labels: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }
  return ([1, 2, 3, 4] as Rating[]).map((r) => {
    const next = schedule(prev, r, now, scheduler, config)
    return { rating: r, label: labels[r], display: fmt(next.due - now) }
  })
}

export function newCardState(now: number): SrsState {
  return {
    state: 'new',
    due: now,
    interval: 0,
    ease_factor: 2.5,
    reps: 0,
    lapses: 0,
    learning_step: 0,
    box: 0,
  }
}
