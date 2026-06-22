import { PrismaClient } from '@prisma/client'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Compose the connection URL from DATABASE_URL + DATABASE_NAME so the database
// name can be configured independently. DATABASE_NAME overrides any db name
// already present in the path of DATABASE_URL.
function databaseUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL is not set')
  const name = process.env.DATABASE_NAME?.trim()
  if (!name) return base
  const u = new URL(base)
  u.pathname = '/' + encodeURIComponent(name)
  return u.toString()
}

// Single Prisma instance (survives tsx watch reloads via globalThis).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: databaseUrl(),
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Media files extracted from .apkg imports are stored on disk, namespaced per
// user. Vercel's project filesystem is read-only, so on Vercel we fall back to
// the writable /tmp dir. WARNING: /tmp is ephemeral and per-instance — uploaded
// media will NOT persist across invocations, so the /media/* routes are not
// durable on serverless. Real media hosting needs external object storage
// (e.g. Vercel Blob or S3).
export const DATA_DIR = process.env.VERCEL ? '/tmp/data' : join(process.cwd(), 'data')
export const MEDIA_DIR = join(DATA_DIR, 'media')
mkdirSync(MEDIA_DIR, { recursive: true })

export function userMediaDir(userId: string) {
  const dir = join(MEDIA_DIR, userId)
  mkdirSync(dir, { recursive: true })
  return dir
}
