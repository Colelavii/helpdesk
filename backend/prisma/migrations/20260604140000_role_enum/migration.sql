-- Convert user.role from TEXT to a native enum without data loss.
-- Existing values ('admin'/'agent') are cast in place via USING rather than
-- dropping and recreating the column (which is what Prisma's auto-diff proposes).

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'agent');

-- AlterTable
ALTER TABLE "user" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "user" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'agent';
