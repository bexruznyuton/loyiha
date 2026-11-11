-- CS GO / CS GO + Atmetka usullari: TagSubmission'ga method ustuni,
-- PENDING_REVIEW/REJECTED statuslari (admin qo'lda tasdiqlaydi).

ALTER TYPE "TagSubmissionStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "TagSubmissionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TYPE "TagSubmissionMethod" AS ENUM ('TAG_ONLY', 'CSGO', 'CSGO_TAG');

ALTER TABLE "tag_submissions" ADD COLUMN "method" "TagSubmissionMethod" NOT NULL DEFAULT 'TAG_ONLY';
