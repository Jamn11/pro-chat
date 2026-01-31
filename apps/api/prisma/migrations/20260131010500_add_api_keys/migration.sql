-- Add BYOK fields for OpenRouter and Brave Search
ALTER TABLE "User" ADD COLUMN "openRouterApiKey" TEXT;
ALTER TABLE "User" ADD COLUMN "braveSearchApiKey" TEXT;
