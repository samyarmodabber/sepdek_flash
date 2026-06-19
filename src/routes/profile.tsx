import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Lock, Mail, ShieldCheck, Trash2, User } from 'lucide-react'
import { api, type Profile } from '../lib/api'
import { changePassword, signOut, updateUser } from '../lib/auth-client'
import { Avatar } from '../lib/avatar'

export const Route = createFileRoute('/profile')({ component: ProfilePage })

function ProfilePage() {
  const profileQ = useQuery({ queryKey: ['profile'], queryFn: api.profile })
  const statsQ = useQuery({ queryKey: ['stats'], queryFn: api.stats })
  const p = profileQ.data

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:p-8">
      <h1 className="text-2xl font-bold">Profile</h1>
      {!p ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : (
        <>
          <Identity profile={p} />
          <AccountInfo profile={p} stats={statsQ.data} />
          <EditProfile profile={p} />
          {p.hasPassword ? <ChangePassword /> : <GoogleNote />}
          <DangerZone email={p.email} />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- sections

function Section({
  title,
  icon,
  children,
  tone,
}: {
  title: string
  icon?: React.ReactNode
  children: React.ReactNode
  tone?: 'danger'
}) {
  return (
    <div
      className="rounded-xl border bg-[var(--panel)] p-5"
      style={{ borderColor: tone === 'danger' ? 'var(--red)' : 'var(--border)' }}
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--muted)]">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  )
}

function Identity({ profile }: { profile: Profile }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <Avatar image={profile.image} name={profile.name} email={profile.email} size={64} />
      <div className="min-w-0">
        <div className="truncate text-lg font-semibold">{profile.name || '—'}</div>
        <div className="truncate text-sm text-[var(--muted)]">{profile.email}</div>
        {profile.bio && <p className="mt-1 text-sm text-[var(--text)]">{profile.bio}</p>}
      </div>
    </div>
  )
}

function EditProfile({ profile }: { profile: Profile }) {
  const qc = useQueryClient()
  const [name, setName] = useState(profile.name)
  const [bio, setBio] = useState(profile.bio ?? '')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // keep the form in sync if the profile is refetched
  useEffect(() => {
    setName(profile.name)
    setBio(profile.bio ?? '')
  }, [profile.name, profile.bio])

  const save = useMutation({
    mutationFn: async () => {
      const res = await updateUser({ name: name.trim(), bio: bio.trim() })
      if (res.error) throw new Error(res.error.message ?? 'Update failed')
    },
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Profile updated.' })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
    onError: (e: unknown) =>
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Update failed' }),
  })

  const dirty = name.trim() !== profile.name || bio.trim() !== (profile.bio ?? '')

  return (
    <Section title="Edit profile" icon={<User size={15} />}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setMsg(null)
          save.mutate()
        }}
      >
        <Field label="Display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="Your name"
          />
        </Field>
        <Field label="Bio">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={500}
            className={inputCls + ' resize-y'}
            placeholder="A few words about you"
          />
        </Field>
        {msg && (
          <p className={msg.kind === 'ok' ? 'text-sm text-[var(--green)]' : 'text-sm text-[var(--red)]'}>
            {msg.text}
          </p>
        )}
        <button type="submit" disabled={!dirty || save.isPending} className={primaryBtn}>
          {save.isPending && <Loader2 size={15} className="animate-spin" />}
          Save changes
        </button>
      </form>
    </Section>
  )
}

function ChangePassword() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const submit = useMutation({
    mutationFn: async () => {
      if (next.length < 8) throw new Error('New password must be at least 8 characters')
      if (next !== confirm) throw new Error('New passwords do not match')
      const res = await changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      })
      if (res.error) throw new Error(res.error.message ?? 'Could not change password')
    },
    onSuccess: () => {
      setMsg({ kind: 'ok', text: 'Password changed.' })
      setCurrent('')
      setNext('')
      setConfirm('')
    },
    onError: (e: unknown) =>
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Could not change password' }),
  })

  return (
    <Section title="Change password" icon={<Lock size={15} />}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setMsg(null)
          submit.mutate()
        }}
      >
        <Field label="Current password">
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        <Field label="New password">
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className={inputCls}
            placeholder="At least 8 characters"
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputCls}
            required
          />
        </Field>
        {msg && (
          <p className={msg.kind === 'ok' ? 'text-sm text-[var(--green)]' : 'text-sm text-[var(--red)]'}>
            {msg.text}
          </p>
        )}
        <button type="submit" disabled={submit.isPending} className={primaryBtn}>
          {submit.isPending && <Loader2 size={15} className="animate-spin" />}
          Update password
        </button>
      </form>
    </Section>
  )
}

function GoogleNote() {
  return (
    <Section title="Password" icon={<Lock size={15} />}>
      <p className="text-sm text-[var(--muted)]">
        You signed in with Google, so there is no password to manage here.
      </p>
    </Section>
  )
}

function AccountInfo({ profile, stats }: { profile: Profile; stats?: { totals: { cards: number; reviews: number }; retention: number | null } }) {
  const since = new Date(profile.created_at).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  return (
    <Section title="Account" icon={<ShieldCheck size={15} />}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <Info label="Email">
          <span className="inline-flex items-center gap-1.5">
            <Mail size={13} className="text-[var(--muted)]" />
            {profile.email}
            {profile.emailVerified && (
              <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--green)]">
                verified
              </span>
            )}
          </span>
        </Info>
        <Info label="Sign-in method">{profile.hasPassword ? 'Email & password' : 'Google'}</Info>
        <Info label="Member since">{since}</Info>
        <Info label="Total cards">{stats ? stats.totals.cards : '…'}</Info>
        <Info label="Total reviews">{stats ? stats.totals.reviews : '…'}</Info>
        <Info label="Retention">
          {stats ? (stats.retention === null ? '—' : `${stats.retention}%`) : '…'}
        </Info>
      </dl>
    </Section>
  )
}

function DangerZone({ email }: { email: string }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const del = useMutation({
    mutationFn: () => api.deleteAccount(),
    onSuccess: async () => {
      await signOut()
      navigate({ to: '/login' })
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Could not delete account'),
  })

  return (
    <Section title="Delete account" icon={<Trash2 size={15} />} tone="danger">
      <p className="mb-3 text-sm text-[var(--muted)]">
        This permanently deletes your account and all decks, cards and review history. This cannot
        be undone. Type <span className="font-mono text-[var(--text)]">{email}</span> to confirm.
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        className={inputCls + ' mb-3'}
        placeholder={email}
      />
      {error && <p className="mb-3 text-sm text-[var(--red)]">{error}</p>}
      <button
        onClick={() => {
          setError(null)
          del.mutate()
        }}
        disabled={confirm !== email || del.isPending}
        className="flex items-center gap-2 rounded-lg bg-[var(--red)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
      >
        {del.isPending && <Loader2 size={15} className="animate-spin" />}
        Delete my account
      </button>
    </Section>
  )
}

// ---------------------------------------------------------------- bits

const inputCls =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]'

const primaryBtn =
  'flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase text-[var(--muted)]">{label}</span>
      {children}
    </label>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-[var(--muted)]">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}
