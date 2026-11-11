-- Admin qo'lda beradigan ko'k "Verify" nishoni (Insy bot → ☑️ Verify).
ALTER TABLE "ad_accounts" ADD COLUMN "verified_badge" BOOLEAN NOT NULL DEFAULT false;
