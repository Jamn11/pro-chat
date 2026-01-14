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
