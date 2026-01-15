# pro-chat

Minimal, full‑featured LLM chat MVP with multi‑model routing via OpenRouter.

## Quick start

1. Install deps:

```bash
npm install
```

2. Create `.env` at the repo root:

```bash
OPENROUTER_API_KEY=your_key
DATABASE_URL=postgresql://user:password@localhost:5432/pro_chat
OPENROUTER_APP_URL=http://localhost:5173
OPENROUTER_APP_NAME=pro-chat
PORT=8787
STORAGE_PATH=storage
```

Optional (tooling + trace retention):

```bash
# Web fetch safeguards & JS rendering
WEB_FETCH_ALLOW_DOMAINS=example.com,docs.example.com
WEB_FETCH_DENY_DOMAINS=internal.local,blocked.com
WEB_FETCH_MAX_REDIRECTS=5
WEB_FETCH_RENDER_MODE=auto # off|auto|always
WEB_FETCH_RENDER_URL=https://your-render-service/render?url=
WEB_FETCH_RENDER_HEADER=X-Render-Token
WEB_FETCH_RENDER_TOKEN=your_token

# Trace retention (assistant reasoning/tool trace)
TRACE_MAX_EVENTS=120
TRACE_MAX_CHARS=50000
TRACE_MAX_SOURCES=40
TRACE_MAX_SOURCE_CHARS=40000
TRACE_MAX_SOURCE_SNIPPET_CHARS=600
TRACE_RETENTION_DAYS=30
```

3. Generate Prisma client + run migrations:

```bash
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api
```

4. Start dev servers:

```bash
npm run dev
```

## Tests and lint

```bash
npm run lint
npm run typecheck
npm test
```

## Notes
- No auth in MVP (private deployment only).
- File uploads stored on local disk at `apps/api/storage` by default.
- Model list is seeded on API boot.
