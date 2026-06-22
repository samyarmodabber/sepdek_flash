import {
  Link,
  Outlet,
  createRootRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { signOut, useSession } from '../lib/auth-client'
import { Avatar } from '../lib/avatar'
import '../styles.css'

export const Route = createRootRoute({
  component: RootComponent,
})

function NavLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} activeOptions={{ exact: to === '/' }}>
      {label}
    </Link>
  )
}

function RootComponent() {
  const { data: session, isPending } = useSession()
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (isPending) return
    if (!session && path !== '/login') navigate({ to: '/login' })
    if (session && path === '/login') navigate({ to: '/' })
  }, [isPending, session, path, navigate])

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--muted)]">
        <Loader2 className="animate-spin" />
      </div>
    )
  }

  // login page (and the brief moment before redirect) renders without the shell
  if (!session) return <Outlet />

  return (
    <div className="flex min-h-screen flex-col">
      <header className="masthead">
        <div className="masthead-wrap">
          <Link to="/" className="brand">
            <span className="mark">
              A<em>·</em>laki
            </span>
            <span className="tag">spaced&nbsp;repetition</span>
          </Link>
          <nav className="tabs">
            <NavLink to="/" label="Decks" />
            <NavLink to="/browse" label="Browse" />
            <NavLink to="/stats" label="Stats" />
          </nav>
          <div className="account flex items-center gap-3 border-l border-[var(--line)] pl-4">
            <Link
              to="/profile"
              className="flex items-center transition hover:opacity-80"
              title={session.user.name || session.user.email}
            >
              <Avatar
                image={session.user.image ?? null}
                name={session.user.name}
                email={session.user.email}
                size={28}
              />
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut()
                navigate({ to: '/login' })
              }}
              className="flex items-center gap-1.5 rounded-[var(--radius)] border border-[var(--line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--muted)] transition hover:border-[var(--ledger)] hover:text-[var(--ledger)]"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
