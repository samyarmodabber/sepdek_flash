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
