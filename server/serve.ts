import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from './index.js'

// Boots the Express app as a long-running Node server — used for local dev
// (`npm run dev`) and single-host production deploys (`npm start`). On Vercel
// this file is never run: there the platform serves the built frontend and
// invokes `app` directly as a serverless function (see api/index.ts).

// Serve the built frontend if it has been built (single-host production).
const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api|\/media).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')))
}

const PORT = Number(process.env.PORT ?? 3001)
app.listen(PORT, () => console.log(`API listening on http://localhost:${PORT}`))
