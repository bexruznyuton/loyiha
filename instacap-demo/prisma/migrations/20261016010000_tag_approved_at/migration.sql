-- Admin tasdiqlagan vaqt: tekshiruv jadvali shundan boshlab hisoblanadi.
ALTER TABLE "tag_submissions" ADD COLUMN "approved_at" TIMESTAMP(3);
