# Post-MVP TODO

## Priority Features
- Memory system
- Search across chats and attachments
- Tools / sandbox (Python)

## Next Session TODO
- Persist thinking/tool-call trace across sessions and thread switches.
- Add JS rendering for web pages (headless browser or prerender service).
- Add trace size limits + retention policy to prevent memory bloat.
- Improve web_fetch robustness: better redirect handling, PDF/text extraction, and domain allow/deny lists.
- Add “view sources” UI for fetched pages + search results (links/snippets).
- Add tool retry/backoff for transient 429/5xx errors.

## Next Steps
- Auth (invite-only → full auth)
- Stripe credits + pay-as-you-go billing
- Object storage migration (S3/R2)
- File size limits + guardrails
- Per-user throttling / rate limits
- Analytics dashboard / charts
- Direct provider support (avoid OpenRouter fee)
