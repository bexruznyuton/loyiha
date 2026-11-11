-- Nakrutka filtri: kam layk/izohli videolar uchun to'lov admin tekshiruviga ushlanadi.
ALTER TABLE "tag_submissions" ADD COLUMN "views_trusted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tag_submissions" ADD COLUMN "review_held_at" TIMESTAMP(3);
