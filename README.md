# agentic-ai

A ChatGPT-style chat service on **OpenRouter**, with conversations persisted in
**Neon Postgres**, a hot **Redis** sliding window in front of it, and a
Next.js UI — deployable to **Vercel** as-is.

## How it works

```
browser ──POST /api/chat (SSE)──> Next route handler
                                      │
                    ┌─────────────────┼──────────────────┐
                    ▼                 ▼                  ▼
               Redis             OpenRouter          Neon Postgres
         (last 50 turns, hot)   (primary model,     (durable transcript,
                                 then fallbacks)      source of truth)
```

**Context.** Each conversation has a UUID. On every turn the last `HISTORY_TURNS`
(default 50) user/assistant exchanges — 100 messages — are replayed as context.
That window is read from a Redis list; on a cache miss it is rehydrated from
Postgres and cached. Writes go to Postgres first, then append to the Redis list
with `LTRIM` keeping it at the window size. **Redis is optional and best-effort
everywhere**: if it is unconfigured or throws, the request falls through to
Postgres instead of failing.

**Reasoning.** `reasoning: { enabled: true }` is sent on every call, and the
`reasoning_details` OpenRouter returns are stored as JSONB and handed back
unmodified on the next request — so reasoning models continue their chain of
thought across turns, exactly like the two-call example in the OpenRouter docs.

**URLs.** Every conversation is addressable at `/c/<id>`, server-rendered, so a
link can be shared or reopened in another tab and arrives with its full
transcript on first paint. A new chat starts at `/` and rewrites the address
bar to `/c/<id>` as soon as the first turn creates the conversation.

**Models.** The catalogue lives in the `models` table, because OpenRouter's
`:free` ids rotate often — a change should be an `UPDATE`, not a redeploy. The
fallback chain is every enabled row in `sort_order`; the `is_default` row is
offered first in the picker. It is read through three tiers — an in-process memo (no I/O), then Redis
(shared), then Postgres — and `OPENROUTER_MODEL` /
`OPENROUTER_FALLBACK_MODELS` remain as a bootstrap for when the table is empty
or unreachable, so a fresh or broken database still answers.

**Fallback.** Requests walk that chain: the model the client asked for, then
each enabled model in order. It advances on
429 / 402 / 408 / 5xx / timeouts, and fails fast on 401/403 rather than burning
through every model with a bad key. While streaming, it only falls back *before*
the first token reaches the client, so a reader never sees a duplicated answer.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in the three services
npm run db:migrate             # creates the tables in Neon
npm run dev                    # http://localhost:3000
```

### Schema and migrations

There is **no ORM**. Queries are hand-written SQL through
`@neondatabase/serverless`, one repository per table under `src/server/db/`.

The schema lives in [`db/schema.sql`](db/schema.sql) and is applied by a script,
so nothing needs to be pasted into the Neon SQL Editor:

```bash
npm run db:migrate                                  # uses .env.local
DATABASE_URL="postgresql://..." npm run db:migrate  # or pass it inline
```

Every statement is `IF NOT EXISTS`, so re-running is safe and is how you apply
the schema to a new branch or environment. Requires PostgreSQL 13+, where
`gen_random_uuid()` is in core — Neon is well past that.

### Environment

Full annotated list in [`.env.example`](.env.example). Summary:

| Variable | Required | Default | Where it comes from |
| --- | --- | --- | --- |
| `OPENROUTER_API_KEY` | **yes** | — | openrouter.ai/keys |
| `DATABASE_URL` | **yes** | — | Neon Console → Connection string (**pooled**, host has `-pooler`) |
| `REDIS_URL` | no | — | `redis://` or `rediss://` connection string |
| `OPENROUTER_MODEL` | no | first Nemotron | **bootstrap only** — the `models` table is the real source |
| `OPENROUTER_FALLBACK_MODELS` | no | see `.env.example` | **bootstrap only**, comma-separated |
| `OPENROUTER_BASE_URL` | no | `https://openrouter.ai/api/v1` | point at a proxy/gateway |
| `OPENROUTER_REASONING` | no | `true` | `false` turns reasoning off |
| `OPENROUTER_TIMEOUT_MS` | no | `55000` | must stay under the 60s function limit |
| `HISTORY_TURNS` | no | `50` | exchanges replayed (×2 = messages) |
| `CACHE_TTL_SECONDS` | no | `86400` | idle lifetime of a cached window |
| `SYSTEM_PROMPT` | no | none | prepended to every conversation |
| `APP_URL` | no | `VERCEL_URL`, else localhost | OpenRouter `HTTP-Referer` (server-side only) |
| `APP_TITLE` | no | `agentic-ai` | OpenRouter `X-Title` |

Without `REDIS_URL` the app still runs — every turn just reads its window from
Postgres instead of cache. `GET /api/health` reports which dependencies resolved.

## API

### `POST /api/chat`

```jsonc
{
  "message": "How many r's are in 'strawberry'?",
  "conversationId": "uuid",   // omit to start a new conversation
  "model": "…",               // optional override
  "stream": true              // default; false returns plain JSON
}
```

Streaming responds with SSE frames:

```
data: {"type":"start","conversationId":"…","historyMessages":12}
data: {"type":"model","model":"google/gemma-4-31b-it:free"}
data: {"type":"reasoning","text":"…"}
data: {"type":"delta","text":"There are "}
data: {"type":"done","messageId":42,"model":"…","usage":{…}}
data: [DONE]
```

With `"stream": false` you get `{ conversationId, messageId, content, reasoning, model, usage, fallbacks }`.

```bash
curl -N http://localhost:3000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"How many r'\''s are in the word '\''strawberry'\''?"}'
```

### Pages

| Path | Renders |
| --- | --- |
| `/` | a new chat |
| `/c/{id}` | that conversation, server-rendered; 404 if it does not exist |

### Conversations

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/conversations?limit=50&offset=0` | list, newest first |
| `POST` | `/api/conversations` | create an empty one |
| `GET` | `/api/conversations/{id}` | conversation + full transcript |
| `PATCH` | `/api/conversations/{id}` | rename |
| `DELETE` | `/api/conversations/{id}` | delete (cascades, clears cache) |
| `GET` | `/api/models` | selectable models + current default |
| `POST` | `/api/models` | drop the cached catalogue after editing the table |
| `GET` | `/api/health` | per-dependency readiness |

## Deploying to Vercel

1. Add the env vars from `.env.example` in **Project → Settings → Environment Variables**
   (Neon and Redis can also be attached through the Vercel Marketplace, which
   injects the connection strings for you).
2. Set `APP_URL` to the production URL — it becomes the `HTTP-Referer`
   OpenRouter attributes traffic to. (No `NEXT_PUBLIC_` prefix: it is read
   server-side only, and `config/env.ts` imports `server-only` to enforce that.)
3. Run `npm run db:migrate` once against the production `DATABASE_URL`.
4. Push, or `vercel --prod`.

`vercel.json` pins the chat function to 60s / 1024MB and deploys to `bom1`
(Mumbai) — **change `regions` to match whichever region your Neon project is in**,
otherwise every query pays a cross-region round trip.

## Layout

Layered: routes adapt HTTP, services hold the logic, repositories own SQL,
models are the shared vocabulary. Nothing below a layer imports from above it.

```
src/
  app/                      HTTP only — parse, delegate, encode
    page.tsx                new chat
    c/[id]/page.tsx         one conversation, at its own shareable URL
    not-found.tsx  layout.tsx  globals.css
    api/chat/route.ts       SSE adapter over chat.service
    api/conversations/      list, create, read, rename, delete
    api/health/route.ts
  components/               Chat, Message, Composer, view-models
  models/                   one file per domain model
    role  reasoning  usage  chat-message  message
    conversation  completion  stream-event  index
  config/
    constants.ts            every fixed literal, in one place
    env.ts                  environment config, namespaced and lazy
  server/
    db/                     client, rows (mappers), one repository per table
    cache/                  client, keys, window.cache, models.cache
    openrouter/             client (transport), model-chain, reasoning,
                            completion, stream, errors
    services/               chat.service, history.service, models.service
  lib/
    sse.ts                  SSE encode/decode, shared by server and browser
    api-client.ts           the browser's only route knowledge
    http.ts
  validation/schemas.ts
db/schema.sql               tables + indexes
scripts/migrate.mjs         applies the schema
```

`@/*` resolves to `src/*`. `.env*`, `next.config.ts`, `tsconfig.json` and
`vercel.json` stay at the root, per the Next.js `src` convention.

**On hardcoded values.** Endpoints, model defaults, cache key prefixes, SSE
tokens, size limits and API paths all live in `config/constants.ts`; anything an
operator should be able to change is an env var on top of that default. The one
unavoidable literal is `maxDuration` in the chat route — Next statically
analyses route segment config, so it cannot be imported.
