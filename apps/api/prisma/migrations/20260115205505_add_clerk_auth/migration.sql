-- Add Clerk authentication fields to User table
-- Handle existing users by assigning them a legacy clerkId

-- Step 1: Add columns as nullable first
ALTER TABLE "User" ADD COLUMN "clerkId" TEXT;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;
ALTER TABLE "User" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "User" ADD COLUMN "updatedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "lastSignInAt" TIMESTAMP(3);

-- Step 2: Set clerkId for existing users (legacy migration)
UPDATE "User" SET "clerkId" = CONCAT('legacy_', id), "updatedAt" = NOW() WHERE "clerkId" IS NULL;

-- Step 3: Make clerkId NOT NULL
ALTER TABLE "User" ALTER COLUMN "clerkId" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Step 4: Add unique constraints and indexes
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_clerkId_idx" ON "User"("clerkId");
