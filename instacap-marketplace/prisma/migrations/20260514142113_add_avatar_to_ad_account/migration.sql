-- AlterTable
ALTER TABLE "ad_accounts" ADD COLUMN     "avatar_file_id" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "niche" SET DEFAULT 'OTHER';
