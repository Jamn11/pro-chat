-- Add trace/sources payloads to Message
ALTER TABLE "Message"
ADD COLUMN "trace" JSONB,
ADD COLUMN "sources" JSONB;
