-- Atmetka qilish (tag campaign) kampaniyasi uchun jadval + TransactionType qiymati

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TAG_REWARD';

CREATE TYPE "TagSubmissionStatus" AS ENUM ('ACTIVE', 'TAG_REMOVED', 'COMPLETED');

CREATE TABLE "tag_submissions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "video_url" TEXT NOT NULL,
    "short_code" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "target_username" TEXT NOT NULL,
    "reward_tiers" JSONB NOT NULL DEFAULT '[]',
    "paid_tiers" JSONB NOT NULL DEFAULT '[]',
    "total_paid" INTEGER NOT NULL DEFAULT 0,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "status" "TagSubmissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "checks_count" INTEGER NOT NULL DEFAULT 0,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tag_submissions_short_code_key" ON "tag_submissions"("short_code");
CREATE INDEX "tag_submissions_user_id_idx" ON "tag_submissions"("user_id");
CREATE INDEX "tag_submissions_status_idx" ON "tag_submissions"("status");

ALTER TABLE "tag_submissions" ADD CONSTRAINT "tag_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
