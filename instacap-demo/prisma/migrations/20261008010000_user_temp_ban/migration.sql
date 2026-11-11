-- Vaqtinchalik foydalanuvchi bloki (nakrutka uchun 1 hafta va h.k.).
ALTER TABLE "users" ADD COLUMN "banned_until" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "ban_reason" TEXT NOT NULL DEFAULT '';
