-- Hamyonning yechib olib bo'lmaydigan qismi (to'ldirilgan va qaytgan pul).
ALTER TABLE "wallets" ADD COLUMN "deposit_balance" INTEGER NOT NULL DEFAULT 0;

-- Boshlang'ich qiymat tarixdan: to'ldirishlar + qaytarishlar − buyurtmaga
-- ushlanganlar (ESCROW_HOLD manfiy yoziladi), 0..balance oralig'ida.
UPDATE "wallets" w SET "deposit_balance" = GREATEST(0, LEAST(w."balance", COALESCE((
  SELECT SUM(t."amount") FROM "transactions" t
  WHERE t."wallet_id" = w."id" AND t."status" = 'COMPLETED'
    AND t."type" IN ('DEPOSIT', 'ESCROW_REFUND', 'ESCROW_HOLD')
), 0)));
