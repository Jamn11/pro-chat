# pro-chat Plan (MVP + Roadmap)

## Goal
Build a fully featured LLM chat web app that rivals major players in capability, starting with a focused MVP optimized for speed and iteration.

## Core Principles
- Web-first MVP, mobile later.
- Fast iteration over infra perfection.
- Fully featured chat UX, even at MVP.
- OpenRouter for provider abstraction (direct providers later).
- Private MVP deployment (no auth yet).

## MVP Scope (Must-Haves)
### Product Features
- Multi-model chat via OpenRouter.
- Per-message model selection (curated subset).
- GPT-5.2 “thinking level” selector: low / medium / high / xhigh.
- System prompt (global per-user setting).
- Streaming responses (SSE) with “thinking” indicator + response timer.
- Multiple chat threads with sidebar, select, and delete.
- File + image upload into chat.
- Server-side chat history.
- Basic cost analytics:
  - Inline per-message cost display.
  - Chat total cost chip in header.
- Light + dark mode with minimal, slightly futuristic, monospace-leaning aesthetic.

### Curated Models (MVP)
- GPT-5.2 (with thinking level selector)
- Gemini 3 Pro
- Claude Opus 4.5
- Claude Sonnet 4.5
- Grok 4.1 Fast

Note: Model IDs will be verified at implementation time.

## Technical Stack (MVP)
- Frontend: React + Vite (web only).
- Backend: Node + Express (TypeScript).
- Database: Managed Postgres + Prisma.
- Streaming: Server-Sent Events (SSE).
- File storage: Local server disk (temporary, no size limits for MVP).

## Architecture (High-Level)
- Monorepo:
  - apps/web (Vite + React)
  - apps/api (Express + TS)
- API server handles:
  - Auth-free access (private deployment only)
  - Chat CRUD + thread management
  - File uploads + attachment handling
  - OpenRouter requests (streaming)
  - Cost calculation and persistence
- DB handles:
  - Users (placeholder; no auth yet)
  - Chat threads
  - Messages
  - Attachments
  - Model metadata (curated subset)
  - Cost records per message and per chat

## UX / UI Direction
- Minimal, slightly futuristic aesthetic.
- Monospace-forward typography (but still readable and clean).
- Clear dark + light modes.
- Terminal-inspired but subtle (not heavy retro styling).
- Strong usability for:
  - Thread creation + selection
  - Model selection per message
  - Streaming feedback + timers
  - Cost visibility

## Open Questions (Resolved)
- Backend: Express
- Streaming: SSE
- System prompt: global setting
- Cost display: inline per message + chat total in header

## Post-MVP Roadmap (Documented TODO)
- Auth system (invite-only → full auth later)
- Stripe credits + pay-as-you-go billing
- Memory system
- Search (across chats + attachments)
- Tools / sandbox (Python)
- Object storage (S3/R2) migration
- File size limits + guardrails
- Per-user throttling / rate limits
- Analytics dashboard / charts
- Direct provider support (avoid OpenRouter fee)

## Milestones
### Milestone 1 — Foundation
- Monorepo structure
- Express API skeleton + Postgres + Prisma
- Basic React app shell + routing + theme system

### Milestone 2 — Core Chat
- Thread CRUD + sidebar UI
- Message sending + storage
- Per-message model selection
- System prompt UI (settings)

### Milestone 3 — Streaming + UX Polish
- SSE streaming from OpenRouter
- Thinking indicator + response timer
- Cost calc per message + chat total
- Light/Dark theme refinement

### Milestone 4 — Files & Images
- Upload pipeline (server disk)
- Attachment UI + persistence
- Model request payloads with attachments

### Milestone 5 — Stabilize MVP
- Error handling + empty states
- Basic performance pass
- Manual QA flows

## Deployment (MVP)
- Private deployment only, no auth.
- Managed Postgres.
- Simple Node server hosting.

## Notes
- No guardrails for file size or content moderation in MVP (documented for later).
- All model IDs and pricing must be verified at implementation time.
