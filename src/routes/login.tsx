import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Brain, Loader2 } from 'lucide-react'
import { signIn, signUp } from '../lib/auth-client'

export const Route = createFileRoute('/login')({ component: Login })

function Login() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res =
        mode === 'signin'
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name: name || email.split('@')[0] })
      if (res.error) {
        setError(res.error.message ?? 'Authentication failed')
      } else {
        navigate({ to: '/' })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const google = async () => {
    setError(null)
    try {
      await signIn.social({ provider: 'google', callbackURL: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-8">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Brain className="text-[var(--accent)]" size={30} />
          <span className="text-2xl font-bold">Alaki</span>
        </div>

        <div className="mb-6 flex rounded-lg bg-[var(--panel-2)] p-1 text-sm">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setError(null)
              }}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                mode === m ? 'bg-[var(--accent)] text-white' : 'text-[var(--muted)]'
              }`}
            >
              {m === 'signin' ? 'Sign in' : 'Sign up'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (
            <Input label="Name" value={name} onChange={setName} placeholder="Your name" />
          )}
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            required
          />
          {error && <p className="text-sm text-[var(--red)]">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] py-2.5 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-[var(--muted)]">
          <div className="h-px flex-1 bg-[var(--border)]" />
          OR
          <div className="h-px flex-1 bg-[var(--border)]" />
        </div>

        <button
          onClick={google}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] py-2.5 font-medium transition hover:bg-[var(--border)]"
        >
          <GoogleIcon /> Continue with Google
        </button>
      </div>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase text-[var(--muted)]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
    </label>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 4.1 29.3 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 4.1 29.3 2 24 2 15.6 2 8.3 6.8 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 46c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 37 26.7 38 24 38c-5.2 0-9.6-3.3-11.2-7.9l-6.5 5C8.3 41.2 15.6 46 24 46z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40.9 36 44 30.5 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  )
}
