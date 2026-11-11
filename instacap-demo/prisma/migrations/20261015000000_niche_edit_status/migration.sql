-- Yangi yo'nalishlar: Edit va Status (filtrda birinchi bo'lib ko'rinadi).
ALTER TYPE "Niche" ADD VALUE IF NOT EXISTS 'EDIT';
ALTER TYPE "Niche" ADD VALUE IF NOT EXISTS 'STATUS';
