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

## Repoga kirmagan narsalar

- `node_modules/`, `venv/` — `pnpm install` / `pip install` bilan tiklanadi
- `dist/`, `backups/` — build natijalari
- `.env`, `.env.bak*` — maxfiy ma'lumotlar
- `*.session` — Telegram sessiyalari
- Ma'lumotlar bazasi dump'lari va holat fayllari
