import { app } from '../server/index.js'

// Vercel serverless entry point. An Express app is itself a (req, res) request
// handler, so we hand it straight to the Node runtime. vercel.json rewrites
// route every /api/* and /media/* request here, and Express matches on the
// original request path.
export default app
