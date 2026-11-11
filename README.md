# Loyihalar to'plami (2026-11-11)

Serverdagi barcha loyihalar bitta repozitoriyda. Har bir loyiha alohida papkada.

## Loyihalar

| Papka | Tavsif | Texnologiya |
|---|---|---|
| `akkmarket/` | akkmarket.com statik landing | HTML/CSS/JS |
| `instacap-demo/` | Demo versiya (topsxema.duckdns.org) | Node.js, Prisma, PostgreSQL, MongoDB |
| `instacap-marketplace/` | Asosiy marketplace (instacap.bustshop.uz) | Node.js, Prisma, PostgreSQL, MongoDB |
| `topsxema/` | topsxema.uz statik sayt | HTML/CSS/JS |
| `vidoctorai/` | Video tahlil Telegram boti | Python, FastAPI, aiogram |
| `topsxema-redirect-bot/` | Redirect Telegram boti | PHP |

## Xavfsizlik

Barcha maxfiy ma'lumotlar (tokenlar, parollar, API kalitlari, baza manzillari)
`CHANGE_ME` bilan almashtirilgan. Ishga tushirishdan oldin:

1. Har bir loyihada `.env.example` dan `.env` yarating:
   ```bash
   cp .env.example .env
   ```
2. `CHANGE_ME` qiymatlarini o'zingizning haqiqiy kalitlaringiz bilan to'ldiring.

**Diqqat:** `.env` fayllari `.gitignore` da — ular hech qachon repoga tushmaydi.

## Ishga tushirish

### Node.js loyihalar (instacap-demo, instacap-marketplace)
```bash
cd instacap-marketplace
cp .env.example .env      # va qiymatlarni to'ldiring
pnpm install
pnpm build
pm2 start <start-skript> --name instacap-marketplace
```

### Python loyiha (vidoctorai)
```bash
cd vidoctorai
cp .env.example .env      # va qiymatlarni to'ldiring
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python bot.py
```

### PHP bot (topsxema-redirect-bot)
```bash
cd topsxema-redirect-bot
# bot.php ichidagi CHANGE_ME ni haqiqiy bot tokeni bilan almashtiring
php bot.php
```

## Manba kodi holati (muhim)

Serverda faqat **qurilgan (build) natijalar** saqlanib qolgan — asl `src/` papkalari
yo'q. Shu sabab manba kod quyidagicha tiklandi:

- `instacap-marketplace/server/` — 58 ta `.ts` fayl `dist/server/*.mjs.map`
  sourcemap'lardan tiklandi va **hozir ishlab turgan** `dist/server/node-build.mjs`
  hamda dinamik chunk'larga (bot-marketplace, tag-campaign, apify-reel, wallet,
  auction) qarab moslashtirildi. `server/auction.mjs` — qo'lda yozilgan JS modul
  (TS manbasi yo'q), `dist/server/auction.mjs` dan olingan.
- `instacap-demo/server/` — 2026-10-25 sourcemap'dan tiklandi. Demo'ning
  2026-11-03 build'i "Top Sxema" brendidagi alohida variant bo'lib, uning
  sourcemap'i saqlanmagan — shuning uchun bu papkadagi kod demo build'ning
  aynan nusxasi emas.
- Frontend (React/TSX) manba kodi serverda umuman yo'q va sourcemap ham
  saqlanmagan. `instacap-marketplace/dist/spa/` va `instacap-demo/dist/spa/`
  ichida faqat minifikatsiya qilingan tayyor build bor.

## Repoga kirmagan narsalar

- `node_modules/`, `venv/` — `pnpm install` / `pip install` bilan tiklanadi
- `backups/`, `*.bak*`, `*.backup*` — eski nusxalar
- `.env`, `.env.bak*` — maxfiy ma'lumotlar
- `*.session` — Telegram sessiyalari
- Ma'lumotlar bazasi dump'lari va holat fayllari

`dist/` papkalari (qurilgan server va spa) deploy ishlashi uchun repoga qo'shilgan.
