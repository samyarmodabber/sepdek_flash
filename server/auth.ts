import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { ObjectId } from 'bson'
import { prisma } from './prisma.js'

const hasGoogle = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'mongodb' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3001',
  trustedOrigins: [process.env.APP_ORIGIN ?? 'http://localhost:3000'],
  // Our Prisma schema uses Mongo @db.ObjectId for primary keys, so better-auth
  // must mint valid 24-char hex ObjectIds rather than its default random strings.
  advanced: {
    database: {
      generateId: () => new ObjectId().toHexString(),
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // Auto-link a Google sign-in to an existing account with the same email.
  // Without this, signing in with Google when that email already has an
  // (e.g. password) account fails with `account_not_linked`. Google verifies
  // its emails, so it is safe to trust for linking.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['google'],
      // The existing local (password) account has emailVerified=false, and
      // better-auth refuses to link onto an unverified local account unless we
      // opt out of that check — otherwise trustedProviders alone isn't enough.
      requireLocalEmailVerified: false,
      // When Google links onto an existing account, copy its profile (name +
      // picture) onto our user. Without this the Google avatar is never stored
      // on a linked account, so the header/profile fall back to initials.
      updateUserInfoOnLink: true,
    },
  },
  // `bio` lives on our User model; declaring it here lets clients set it via
  // updateUser and includes it on the session user.
  user: {
    additionalFields: {
      bio: { type: 'string', required: false, input: true },
    },
  },
  socialProviders: hasGoogle
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID as string,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        },
      }
    : undefined,
})

export type Auth = typeof auth
