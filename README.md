# Alaki — a multi-user Anki-style flashcard app

A spaced-repetition flashcard web app, modeled on Anki. Frontend: **TanStack Router +
TanStack Query**. Backend: **Express + Prisma + MongoDB**. Users sign up (email/password
or Google) and each user has their own private decks. You can import real Anki **`.apkg`**
decks.

## Features

- **Accounts** — email/password and Google sign-in via **better-auth**. Every deck, note,
  card and review row is scoped to a `userId`; users never see each other's data.
- **Import `.apkg`** — unzips the package, reads the embedded Anki SQLite collection, and
  normalizes it into MongoDB. Supports:
  - classic format (`collection.anki2` / `collection.anki21`, JSON models in `col`)
  - newer format (`collection.anki21b`, **zstd**-compressed, schema 18+ with
    `notetypes` / `templates` / `fields` tables decoded from protobuf)
  - media files (classic JSON map and the new protobuf media index), stored per user
- **Template rendering** — `{{Field}}`, `{{FrontSide}}`, `{{#}}`/`{{^}}` conditionals,
  field filters (`text:`, `hint:`, `cloze:`, …) and **cloze deletions**.
- **SM-2 scheduler** with Anki-style learning steps (`server/srs.ts`).
- **Study / Browse / Stats** — flip + rate with keyboard shortcuts (Space, 1–4); search,
  add/edit/delete/suspend; retention, review heatmap, 30-day due forecast.
- Hierarchical decks (Anki `::` names → parent/child). Dark theme.

## Why Prisma + MongoDB

The data layer goes through Prisma, so switching databases later means changing the
`provider` in `prisma/schema.prisma` (plus the Mongo-specific `@db.ObjectId` id defaults)
rather than rewriting queries. MongoDB Atlas is recommended for dev because Prisma needs a
replica set for transactions, which Atlas provides out of the box.

> Note: the Anki `.apkg` file is itself a SQLite database, so `better-sqlite3` is still a
> dependency — but only to **read uploaded decks during import**. The app's own data lives
> in MongoDB.

## Architecture

```
prisma/schema.prisma    User/Session/Account (better-auth) + Deck/NoteType/Note/Card/Review
server/                 Express API (run with tsx)
  prisma.ts             Prisma client singleton + per-user media dir
  auth.ts               better-auth (email/password + Google, Prisma adapter)
  srs.ts                SM-2 scheduling (pure functions)
  index.ts              REST API, auth gate, static media, prod static frontend
  anki/{apkg,render,normalize}.ts   import pipeline
src/                    TanStack Router frontend
  lib/{api,auth-client}.ts
  routes/               login, index (decks), study.$deckId, browse, stats
scripts/smoke.ts        offline test (parse .apkg, render, schedule)
data/media/<userId>/    extracted media (git-ignored)
```

Dev: Vite (port **3000**) proxies `/api` and `/media` to the API server (port **3001**).

## Setup

1. **Install**

   ```bash
   npm install
   ```
2. **MongoDB Atlas** — create a free cluster, a DB user, and allow your IP. Copy the
   connection string into `.env` as `DATABASE_URL`, and set `DATABASE_NAME` to the
   database to use (it is injected into the URL at runtime and overrides any db name in
   the URL path). See `.env.example`.
3. **Auth secrets** — in `.env`:

   ```
   BETTER_AUTH_SECRET="<openssl rand -base64 32>"
   BETTER_AUTH_URL="http://localhost:3001"
   APP_ORIGIN="http://localhost:3000"
   ```
4. **Google OAuth** (optional — email/password works without it) — create an OAuth client
   at [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials), set the redirect URI to
   `http://localhost:3001/api/auth/callback/google`, and put the id/secret in `.env`.
   If `GOOGLE_CLIENT_ID`/`SECRET` are empty, the Google button is simply inactive.
5. **Generate the Prisma client** (re-run after schema changes):

   ```bash
   npx prisma generate
   ```

   MongoDB is schemaless, so no migration step is needed — collections are created on
   first write.

## Running

```bash
npm run dev        # API (3001) + Vite (3000); open http://localhost:3000
```

Other scripts:

```bash
npm run build      # build the frontend to dist/
npm start          # serve API + built frontend from one process (port 3001)
npx tsx scripts/smoke.ts   # offline import/render/scheduler test
```

## Notes / limitations

- Imported cards start as **new** (original Anki scheduling history is not carried over).
- Media is served statically (`/media/<userId>/<file>`) without a per-request auth check —
  fine for a flashcard app, but don't store sensitive media.
- `type:` answer-input fields render as empty; manual cards use a built-in **Basic** type.

## strategy
