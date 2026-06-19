import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { Auth } from '../../server/auth'

// Same-origin: the Vite dev server proxies /api/auth/* to the API server,
// and in production both are served from the same origin.
// inferAdditionalFields mirrors the server's custom user fields (e.g. `bio`)
// so updateUser and the session user are typed correctly.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [inferAdditionalFields<Auth>()],
})

export const { signIn, signUp, signOut, useSession, updateUser, changePassword } =
  authClient
