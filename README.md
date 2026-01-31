# pro-chat

A desktop‑only, local‑first chat client for OpenRouter models. Built with Tauri for macOS, it keeps your data on disk, supports bring‑your‑own keys, and makes switching between dozens of models fast and delightful.

## Why it’s different

- **Desktop‑only**: no hosted web UI, no server to run in production.
- **Local‑first**: SQLite + file storage on your machine.
- **Multi‑model by default**: OpenAI, Claude, Gemini, Kimi, GLM, and more.
- **Power‑user friendly**: model search, slash commands, attachments, and memory.
- **Transparent costs**: per‑message usage & spend tracking.

## Quick start

1. Install deps:

```bash
npm install
```

2. Create `.env` at the repo root:

```bash
DATABASE_URL=file:./data/pro-chat.db
OPENROUTER_APP_URL=http://localhost:5173
OPENROUTER_APP_NAME=pro-chat
PORT=8787
STORAGE_PATH=storage
MEMORY_PATH=memory
```

OpenRouter + Brave Search keys are configured in-app under Settings.

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

3. Generate Prisma client + sync schema:

```bash
npm run prisma:generate -w apps/api
npm run prisma:migrate -w apps/api
```

4. Run the desktop app in dev:

```bash
make dev
```

Build:

```bash
make app
```

## Tests and lint

```bash
npm run lint
npm run typecheck
npm test
```

## Notes
- This repo targets macOS desktop only. The UI is rendered in a Tauri webview and is not shipped as a standalone web app.
- SQLite database is stored at `apps/api/prisma/data/pro-chat.db` in dev when using the default `.env`. In the packaged desktop app it lives in the app data directory (macOS: `~/Library/Application Support/com.prochat.desktop/pro-chat.db`).
- File uploads stored on local disk at `apps/api/storage` by default (desktop uses its app data directory).
- Model list is seeded on API boot.
