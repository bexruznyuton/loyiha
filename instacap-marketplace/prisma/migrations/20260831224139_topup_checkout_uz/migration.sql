-- Hamyon to'ldirishni checkout.uz (avtomatik to'lov) bilan ulash uchun.
-- Barcha ustunlar DEFAULT bilan qo'shiladi — mavjud "topups" qatorlariga
-- (qo'lda-karta usuli, provider='MANUAL') ta'sir qilmaydi.
ALTER TABLE "topups" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "topups" ADD COLUMN     "provider_payment_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "topups" ADD COLUMN     "provider_uuid" TEXT NOT NULL DEFAULT '';
ALTER TABLE "topups" ADD COLUMN     "pay_urls" JSONB NOT NULL DEFAULT '{}';

-- CreateIndex
CREATE INDEX "topups_provider_status_idx" ON "topups"("provider", "status");
