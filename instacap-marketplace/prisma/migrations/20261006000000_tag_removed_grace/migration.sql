-- Atmetka olib tashlangan videolar uchun 2 kunlik muhlat: TAG_REMOVED bo'lgan payt.
ALTER TABLE "tag_submissions" ADD COLUMN "tag_removed_at" TIMESTAMP(3);

-- Allaqachon TAG_REMOVED bo'lganlarga muhlat hozirdan boshlanadi.
UPDATE "tag_submissions" SET "tag_removed_at" = NOW() WHERE "status" = 'TAG_REMOVED';
