// Auction & Tag Campaign V2 Module using PrismaClient
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
const prisma = new PrismaClient();

export function setupAuctionAndDemoRoutes(app, getBot) {
  console.log("рџљЂ Mounting Auction & Demo V2 System with Prisma...");

  // Helper to serialize BigInt
  const cleanJson = (obj) => JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));

  // Yutuq rasmi (sovg'a akkaunt surati) — SPA ichiga fayl sifatida saqlanadi
  const PRIZE_UPLOAD_DIR = path.join(import.meta.dirname, '..', 'spa', 'uploads', 'prizes');
  const PRIZE_MAX_BYTES = 4 * 1024 * 1024;
  const PRIZE_MIME_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

  function savePrizePhoto(dataUrl, seed) {
    if (!dataUrl || typeof dataUrl !== 'string') return null;
    if (!dataUrl.startsWith('data:')) return null;
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
    if (!m) return null;
    const mime = m[1].toLowerCase();
    const ext = PRIZE_MIME_EXT[mime];
    if (!ext) return null;
    let buf;
    try {
      buf = Buffer.from(m[2], 'base64');
    } catch (e) {
      return null;
    }
    if (!buf.length || buf.length > PRIZE_MAX_BYTES) return null;
    try {
      fs.mkdirSync(PRIZE_UPLOAD_DIR, { recursive: true });
    } catch (e) {
      return null;
    }
    const safeSeed = String(seed || 'prize').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    const fileName = `${safeSeed}-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(PRIZE_UPLOAD_DIR, fileName), buf);
    return `/uploads/prizes/${fileName}`;
  }

  function isHttpUrl(v) {
    if (!v || typeof v !== 'string') return false;
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  // Server vaqti — mijoz taymeri (brauzer soati serverdan farq qilishi mumkin)
  app.get('/api/time', (_req, res) => {
    res.json({ success: true, serverTime: Date.now() });
  });

  // 1. Settings GET
  app.get('/api/demo/settings', async (_req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe("SELECT key, value FROM demo_settings");
      const map = {};
      for (const r of rows) map[r.key] = r.value;
      const dailyBudget = parseInt(map['tag_daily_budget'] || '1000000', 10);
      let spentBudget = 0;
      try {
        const spentRows = await prisma.$queryRawUnsafe("SELECT COALESCE(SUM(total_paid), 0)::int as spent FROM tag_submissions WHERE created_at >= CURRENT_DATE");
        spentBudget = spentRows && spentRows[0] ? Number(spentRows[0].spent) : 0;
      } catch (err) {}
      // Admin qo'lda kiritgan "sarflangan" qiymati (bo'sh bo'lsa — avtomatik hisob)
      const spentOverrideRaw = map['tag_spent_override'];
      const spentOverride = spentOverrideRaw !== undefined && spentOverrideRaw !== '' ? parseInt(spentOverrideRaw, 10) : null;
      const spentIsManual = Number.isFinite(spentOverride);
      if (spentIsManual) spentBudget = spentOverride;
      const remainingBudget = Math.max(0, dailyBudget - spentBudget);

      res.json({
        success: true,
        targetUsername: map['tag_target_username'] || 'top_sxema_rek67',
        rateStandard500k: parseInt(map['tag_rate_500k_standard'] || '20000', 10),
        rateExtraWord500k: parseInt(map['tag_rate_500k_extra_word'] || '30000', 10),
        extraWordKeyword: map['tag_extra_word_keyword'] || '#topsxema',
        rulesText: map['tag_rules_text'] || '',
        dailyBudget,
        spentBudget,
        spentIsManual,
        remainingBudget,
      });
    } catch (e) {
      console.error("GET /api/demo/settings error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 2. Settings POST (Admin Only: 8897050018)
  app.post('/api/demo/settings', async (req, res) => {
    try {
      const { targetUsername, rateStandard500k, rateExtraWord500k, extraWordKeyword, rulesText, dailyBudget, spentBudgetOverride, adminTgId } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }

      if (targetUsername) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at) 
          VALUES ('tag_target_username', $1, NOW()) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, targetUsername.replace(/^@/, '').trim());

        await prisma.$executeRawUnsafe(`
          INSERT INTO settings (key, value) 
          VALUES ('tag_campaign_target_username', $1) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, targetUsername.replace(/^@/, '').trim());
      }

      if (dailyBudget !== undefined) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at)
          VALUES ('tag_daily_budget', $1, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, String(dailyBudget));
      }

      // Jonli byudjet: "sarflangan" summani qo'lda boshqarish (bo'sh = avtomatik)
      if (spentBudgetOverride !== undefined) {
        const raw = String(spentBudgetOverride).trim();
        if (raw === '') {
          await prisma.$executeRawUnsafe(`DELETE FROM demo_settings WHERE key = 'tag_spent_override'`);
        } else {
          const num = parseInt(raw, 10);
          if (!Number.isFinite(num) || num < 0) {
            return res.status(400).json({ success: false, error: 'Sarflangan summa noto\'g\'ri' });
          }
          await prisma.$executeRawUnsafe(`
            INSERT INTO demo_settings (key, value, updated_at)
            VALUES ('tag_spent_override', $1, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `, String(num));
        }
      }

      if (rateStandard500k !== undefined) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at) 
          VALUES ('tag_rate_500k_standard', $1, NOW()) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, String(rateStandard500k));

        const rStd = Number(rateStandard500k);
        const stdTiers = [
          { views: 500000, reward: rStd },
          { views: 1000000, reward: rStd * 2 },
          { views: 1500000, reward: rStd * 3 },
          { views: 2000000, reward: rStd * 4 },
          { views: 3000000, reward: rStd * 6 },
          { views: 5000000, reward: rStd * 10 }
        ];
        await prisma.$executeRawUnsafe(`
          INSERT INTO settings (key, value) 
          VALUES ('tag_campaign_reward_tiers', $1) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, JSON.stringify(stdTiers));
      }

      if (rateExtraWord500k !== undefined) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at) 
          VALUES ('tag_rate_500k_extra_word', $1, NOW()) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, String(rateExtraWord500k));

        const rExt = Number(rateExtraWord500k);
        const extTiers = [
          { views: 500000, reward: rExt },
          { views: 1000000, reward: rExt * 2 },
          { views: 1500000, reward: rExt * 3 },
          { views: 2000000, reward: rExt * 4 },
          { views: 3000000, reward: rExt * 6 },
          { views: 5000000, reward: rExt * 10 }
        ];
        await prisma.$executeRawUnsafe(`
          INSERT INTO settings (key, value) 
          VALUES ('tag_campaign_csgo_tag_reward_tiers', $1) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, JSON.stringify(extTiers));
      }

      if (extraWordKeyword) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at) 
          VALUES ('tag_extra_word_keyword', $1, NOW()) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, extraWordKeyword.trim());
      }

      if (rulesText !== undefined) {
        await prisma.$executeRawUnsafe(`
          INSERT INTO demo_settings (key, value, updated_at) 
          VALUES ('tag_rules_text', $1, NOW()) 
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `, rulesText);
      }

      res.json({ success: true, message: "Sozlamalar saqlandi!" });
    } catch (e) {
      console.error("POST /api/demo/settings error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 2b. Broadcast message via Telegram Bot (Admin Only: 8897050018)
  app.post('/api/demo/broadcast', async (req, res) => {
    try {
      const { adminTgId, targetType, targetTelegramId, messageText } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }
      if (!messageText || !messageText.trim()) {
        return res.status(400).json({ success: false, error: 'Xabar matnini kiriting' });
      }

      const bot = getBot ? getBot() : null;
      if (!bot) {
        return res.status(500).json({ success: false, error: 'Telegram bot faol emas yoki ulanmagan' });
      }

      const text = messageText.trim();
      let sentCount = 0;
      let failCount = 0;

      if (targetType === 'single') {
        if (!targetTelegramId || !String(targetTelegramId).trim()) {
          return res.status(400).json({ success: false, error: 'Foydalanuvchi Telegram ID sini kiriting' });
        }
        const tid = String(targetTelegramId).trim();
        try {
          await bot.sendMessage(tid, text, { parse_mode: 'HTML' });
          return res.json({ success: true, message: `Xabar foydalanuvchiga muvaffaqiyatli yuborildi (ID: ${tid})` });
        } catch (err) {
          return res.status(400).json({ success: false, error: `Bot orqali yuborilmadi: ${err.message}` });
        }
      } else {
        const users = await prisma.$queryRawUnsafe(`
          SELECT DISTINCT telegram_id FROM users WHERE telegram_id IS NOT NULL
        `);
        console.log(`рџ“ў Broadcasting to ${users.length} users...`);

        for (const u of users) {
          if (!u.telegram_id) continue;
          try {
            await bot.sendMessage(String(u.telegram_id), text, { parse_mode: 'HTML' });
            sentCount++;
            await new Promise(r => setTimeout(r, 45)); // Rate limiting
          } catch (e) {
            failCount++;
          }
        }

        return res.json({
          success: true,
          message: `Xabar muvaffaqiyatli tarqatildi! Yuborildi: ${sentCount} ta, Yetkazilmadi: ${failCount} ta`,
          sentCount,
          failCount
        });
      }
    } catch (e) {
      console.error("POST /api/demo/broadcast error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 2c. Wallet Topup by Admin (POST /api/demo/wallets/topup)
  app.post('/api/demo/wallets/topup', async (req, res) => {
    try {
      const { adminTgId, targetTelegramId, amount, note } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }
      const numAmt = parseInt(amount, 10);
      if (!Number.isFinite(numAmt) || numAmt <= 0) return res.status(400).json({ success: false, error: 'Noto\'g\'ri summa' });

      let targetTg;
      try {
        targetTg = BigInt(targetTelegramId);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Telegram ID noto\'g\'ri' });
      }
      const uRows = await prisma.$queryRawUnsafe('SELECT id, first_name FROM users WHERE telegram_id = $1', targetTg);
      let userId;
      if (uRows && uRows.length > 0) {
        userId = uRows[0].id;
      } else {
        const newU = await prisma.$queryRawUnsafe(`
          INSERT INTO users (telegram_id, first_name) VALUES ($1, 'Foydalanuvchi') RETURNING id
        `, targetTg);
        userId = newU[0].id;
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO wallets (user_id, balance, frozen_balance, deposit_balance, total_earned, total_spent, currency, created_at, updated_at)
        VALUES ($1, $2, 0, 0, $2, 0, 'UZS', NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET balance = wallets.balance + $2, updated_at = NOW()
      `, userId, numAmt);

      res.json({ success: true, message: `Foydalanuvchi balansi ${numAmt.toLocaleString('uz-UZ')} UZS ga to'ldirildi!` });
    } catch (e) {
      console.error("POST /api/demo/wallets/topup error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 2d. Wallet Debit by Admin — "pul ayirish" (POST /api/demo/wallets/debit)
  app.post('/api/demo/wallets/debit', async (req, res) => {
    try {
      const { adminTgId, targetTelegramId, amount, note } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }
      const numAmt = parseInt(amount, 10);
      if (!Number.isFinite(numAmt) || numAmt <= 0) return res.status(400).json({ success: false, error: 'Noto\'g\'ri summa' });

      let targetTg;
      try {
        targetTg = BigInt(targetTelegramId);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Telegram ID noto\'g\'ri' });
      }

      const uRows = await prisma.$queryRawUnsafe('SELECT id FROM users WHERE telegram_id = $1', targetTg);
      if (!uRows || uRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Foydalanuvchi topilmadi' });
      }
      const userId = uRows[0].id;

      const wRows = await prisma.$queryRawUnsafe('SELECT id, balance FROM wallets WHERE user_id = $1', userId);
      if (!wRows || wRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Foydalanuvchining hamyoni topilmadi' });
      }
      const walletId = wRows[0].id;

      // Atomik ayirish — balans yetarli bo'lmasa ayirilmaydi
      const deducted = await prisma.$executeRawUnsafe(`
        UPDATE wallets
        SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW()
        WHERE id = $2 AND balance >= $1
      `, numAmt, walletId);

      if (!deducted) {
        const cur = await prisma.$queryRawUnsafe('SELECT balance FROM wallets WHERE id = $1', walletId);
        const bal = cur && cur[0] ? Number(cur[0].balance) : 0;
        return res.status(400).json({
          success: false,
          error: `Balans yetarli emas. Hozirgi balans: ${bal.toLocaleString('uz-UZ')} UZS`
        });
      }

      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO transactions (wallet_id, type, amount, status, note, created_at)
          VALUES ($1, 'ADJUSTMENT', $2, 'COMPLETED', $3, NOW())
        `, walletId, -numAmt, note || 'Admin tomonidan balansdan pul ayirildi');
      } catch (tErr) {}

      res.json({ success: true, message: `Balansdan ${numAmt.toLocaleString('uz-UZ')} UZS ayirildi` });
    } catch (e) {
      console.error("POST /api/demo/wallets/debit error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 3. Auctions GET list
  app.get('/api/auctions', async (_req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT a.id, a.creator_id, a.title, a.instagram_username, a.instagram_avatar, 
               COALESCE(a.instagram_url, '') as instagram_url,
               COALESCE(a.description, '') as description,
               COALESCE(a.note, '') as note,
               COALESCE(a.currency, 'UZS') as currency, 
               a.audience_size, a.starting_price, a.min_step, a.current_bid, a.current_winner_id,
               a.winner_telegram_id, a.winner_name, a.winner_avatar,
               a.admin_telegram_id, a.admin_name, a.admin_username,
               a.ends_at, a.status, a.created_at,
               COALESCE(a.prize_photo, '') as prize_photo,
               COALESCE(a.prize_details, '{}'::jsonb) as prize_details,
               a.winner_visible_until, a.winner_dismissed, a.refunded_at,
               COUNT(b.id)::int as bids_count,
               COUNT(DISTINCT b.telegram_id)::int as players_count,
               w.first_name as winner_user_name,
               w.username as winner_user_handle
        FROM auctions a
        LEFT JOIN auction_bids b ON b.auction_id = a.id
        LEFT JOIN users w ON w.id = a.current_winner_id
        GROUP BY a.id, w.id, w.first_name, w.username
        ORDER BY
          (a.status = 'ACTIVE') DESC,
          CASE WHEN a.status = 'ACTIVE' THEN a.ends_at END ASC,
          CASE WHEN a.status <> 'ACTIVE' THEN a.ends_at END DESC,
          a.id DESC
      `);
      res.json({ success: true, auctions: cleanJson(rows) });
    } catch (e) {
      console.error("GET /api/auctions error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 4. Single Auction GET (with wheel slices and players)
  app.get('/api/auctions/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const aucRows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!aucRows || aucRows.length === 0) return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      const auction = cleanJson(aucRows[0]);

      // Bids list with user details
      const bids = cleanJson(await prisma.$queryRawUnsafe(`
        SELECT id, user_id, telegram_id, user_name, user_avatar, amount, created_at
        FROM auction_bids
        WHERE auction_id = $1
        ORDER BY amount DESC, created_at DESC
      `, id));

      // Calculate total pot and player shares for Portals Game Wheel
      const totalPot = bids.reduce((sum, b) => sum + Number(b.amount || 0), 0);
      const playerMap = new Map();
      for (const b of bids) {
        const tgIdStr = String(b.telegram_id);
        if (!playerMap.has(tgIdStr)) {
          playerMap.set(tgIdStr, {
            telegramId: tgIdStr,
            userName: b.user_name,
            userAvatar: b.user_avatar,
            totalBid: Number(b.amount),
            percentage: 0
          });
        }
      }

      const players = Array.from(playerMap.values()).map(p => {
        p.percentage = totalPot > 0 ? parseFloat(((p.totalBid / totalPot) * 100).toFixed(2)) : 0;
        return p;
      });

      res.json({
        success: true,
        auction,
        bids,
        players,
        totalPot,
      });
    } catch (e) {
      console.error("GET /api/auctions/:id error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 4b. User Balance (GET /api/demo/users/:tgId/balance)
  app.get('/api/demo/users/:tgId/balance', async (req, res) => {
    try {
      const tgId = BigInt(req.params.tgId);
      const rows = await prisma.$queryRawUnsafe(`
        SELECT COALESCE(w.balance, 0)::text as balance
        FROM users u
        LEFT JOIN wallets w ON w.user_id = u.id
        WHERE u.telegram_id = $1
      `, tgId);
      const balance = rows && rows.length > 0 ? Number(rows[0].balance) : 0;
      res.json({ success: true, balance, currency: 'UZS' });
    } catch (e) {
      // Soxta balans qaytarilmaydi вЂ” xatoda 0 (avval100000 edi)
      res.json({ success: true, balance: 0, currency: 'UZS' });
    }
  });

  // 5. Place a Bid (POST /api/auctions/:id/bid)
  app.post('/api/auctions/:id/bid', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { amount, telegramId, userName, userAvatar } = req.body;
      const numAmount = parseInt(amount, 10);

      if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri summa' });
      }
      if (!telegramId) {
        return res.status(400).json({ success: false, error: 'Telegram ID kiritilmadi' });
      }

      const aucRows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!aucRows || aucRows.length === 0) {
        return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      }

      const auction = aucRows[0];
      if (auction.status !== 'ACTIVE') {
        return res.status(400).json({ success: false, error: 'Auksion yakunlangan yoki faol emas' });
      }

      const now = new Date();
      if (new Date(auction.ends_at) <= now) {
        await prisma.$executeRawUnsafe("UPDATE auctions SET status = 'COMPLETED' WHERE id = $1", id);
        return res.status(400).json({ success: false, error: 'Auksion vaqti tugadi!' });
      }

      // If min_step > 0, validate minimum allowed bid
      const minStep = Number(auction.min_step || 0);
      if (minStep > 0) {
        const minAllowed = Number(auction.current_bid || 0) + minStep;
        if (numAmount < minAllowed) {
          return res.status(400).json({
            success: false,
            error: `Minimal stavka: ${minAllowed.toLocaleString('uz-UZ')} UZS bo'lishi kerak!`
          });
        }
      } else {
        // Erkin rejim: boshlang'ich narxdan pastga tushib bo'lmaydi.
        // (Oldingi shart current_bid === 0 ga tegardi, ammo current_bid doim
        //  boshlang'ich narxga teng boshlanadi вЂ” ya'ni tekshiruv ishlamay qolgan.)
        const floorPrice = Math.max(
          Number(auction.starting_price || 0),
          Number(auction.current_bid || 0)
        );
        if (numAmount < floorPrice) {
          return res.status(400).json({
            success: false,
            error: `Kamida ${floorPrice.toLocaleString('uz-UZ')} UZS bo'lishi kerak!`
          });
        }
      }

      // Find or create user
      let userId = null;
      let bigTgId;
      try {
        bigTgId = BigInt(telegramId);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Telegram ID noto\'g\'ri' });
      }
      const uRows = await prisma.$queryRawUnsafe("SELECT id FROM users WHERE telegram_id = $1", bigTgId);
      if (uRows && uRows.length > 0) {
        userId = uRows[0].id;
      } else {
        const newU = await prisma.$queryRawUnsafe(`
          INSERT INTO users (telegram_id, first_name, username, photo_url)
          VALUES ($1, $2, '', $3)
          ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name
          RETURNING id
        `, bigTgId, userName || 'Ishtirokchi', userAvatar || '');
        userId = newU[0].id;
      }

      // Check user wallet balance in UZS
      const wRows = await prisma.$queryRawUnsafe("SELECT id, balance FROM wallets WHERE user_id = $1", userId);
      let userBalance = 0;
      let walletId = null;
      if (wRows && wRows.length > 0) {
        userBalance = Number(wRows[0].balance);
        walletId = wRows[0].id;
      } else {
        const newW = await prisma.$queryRawUnsafe(`
          INSERT INTO wallets (user_id, balance, frozen_balance, deposit_balance, total_earned, total_spent, currency, created_at, updated_at)
          VALUES ($1, 0, 0, 0, 0, 0, 'UZS', NOW(), NOW())
          RETURNING id, balance
        `, userId);
        userBalance = Number(newW[0].balance);
        walletId = newW[0].id;
      }

      // Atomik ayirish: balans yetarli bo'lgandagina kamayadi (race condition himoyasi)
      const deducted = await prisma.$executeRawUnsafe(`
        UPDATE wallets 
        SET balance = balance - $1, total_spent = total_spent + $1, updated_at = NOW() 
        WHERE id = $2 AND balance >= $1
      `, numAmount, walletId);

      if (!deducted) {
        return res.status(400).json({
          success: false,
          error: `Hamyoningizda mablag' yetarli emas! Balansingiz: ${userBalance.toLocaleString('uz-UZ')} UZS. Talab qilinadi: ${numAmount.toLocaleString('uz-UZ')} UZS.`
        });
      }

      // Record transaction
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO transactions (wallet_id, type, amount, status, note, created_at)
          VALUES ($1, 'AUCTION_BID', $2, 'COMPLETED', $3, NOW())
        `, walletId, numAmount, `Auksion #${id} uchun stavka`);
      } catch (tErr) {}

      // Insert Bid in UZS
      await prisma.$executeRawUnsafe(`
        INSERT INTO auction_bids (auction_id, user_id, telegram_id, user_name, user_avatar, amount, currency)
        VALUES ($1, $2, $3, $4, $5, $6, 'UZS')
      `, id, userId, bigTgId, userName || 'Ishtirokchi', userAvatar || '', numAmount);

      // Update Auction current bid, winner and currency
      await prisma.$executeRawUnsafe(`
        UPDATE auctions
        SET current_bid = GREATEST(current_bid, $1), current_winner_id = $2, currency = 'UZS',
            winner_telegram_id = $3, winner_name = $4, winner_avatar = $5
        WHERE id = $6
      `, numAmount, userId, bigTgId, userName || 'Ishtirokchi', userAvatar || '', id);

      res.json({
        success: true,
        message: 'Stavka muvaffaqiyatli qabul qilindi!',
        newBid: numAmount,
      });
    } catch (e) {
      console.error("POST /api/auctions/:id/bid error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6. Create Auction (POST /api/auctions) - Full Account Details & Configurable Options
  app.post('/api/auctions', async (req, res) => {
    try {
      const { 
        telegramId, 
        title, 
        instagramUsername, 
        instagramUrl,
        instagramAvatar,
        audienceSize, 
        description,
        note,
        startingPrice, 
        minStep, 
        durationHours,
        prizePhoto,
        prizeDetails
      } = req.body;

      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID kerak' });

      const isAdmin = String(telegramId) === '8897050018';
      if (!isAdmin) {
        const pRows = await prisma.$queryRawUnsafe('SELECT 1 FROM auction_permissions WHERE telegram_id = $1', BigInt(telegramId));
        if (!pRows || pRows.length === 0) {
          return res.status(403).json({ success: false, error: 'Sizga auksion ochish huquqi berilmagan' });
        }
      }

      const cleanUsername = (instagramUsername || '').replace(/^@/, '').trim();
      if (!cleanUsername) {
        return res.status(400).json({ success: false, error: 'Instagram username kiritilmadi' });
      }

      const hours = parseFloat(durationHours !== undefined && durationHours !== '' ? durationHours : '2.0');
      const sPrice = parseInt(startingPrice !== undefined && startingPrice !== '' ? startingPrice : '50000', 10);
      const mStep = parseInt(minStep !== undefined && minStep !== '' ? minStep : '10000', 10);

      if (!Number.isFinite(hours) || hours <= 0) {
        return res.status(400).json({ success: false, error: 'Davomiylilik noto\'g\'ri (soat)' });
      }
      if (!Number.isFinite(sPrice) || sPrice < 0) {
        return res.status(400).json({ success: false, error: 'Boshlang\'ich narx noto\'g\'ri' });
      }
      if (!Number.isFinite(mStep) || mStep < 0) {
        return res.status(400).json({ success: false, error: 'Minimal qadam noto\'g\'ri' });
      }

      const endsAt = new Date(Date.now() + Math.round(hours * 60 * 60 * 1000));
      if (!Number.isFinite(endsAt.getTime())) {
        return res.status(400).json({ success: false, error: 'Tugash vaqti hisoblab bo\'lmadi' });
      }

      const directUrl = (instagramUrl && instagramUrl.trim()) ? instagramUrl.trim() : `https://instagram.com/${cleanUsername}`;
      // Soxta (Unsplash) avatar fallback olib tashlandi вЂ” bo'sh qoladi, UI boshlang'ich harf ko'rsatadi
      const defaultAvatar = (instagramAvatar && instagramAvatar.trim()) ? instagramAvatar.trim() : '';
      const audText = (audienceSize && audienceSize.trim()) ? audienceSize.trim() : '';

      // Yutuq rasmi: data-URL (base64) yoki tayyor URL
      let photoPath = '';
      if (prizePhoto) {
        if (typeof prizePhoto === 'string' && prizePhoto.startsWith('data:')) {
          photoPath = savePrizePhoto(prizePhoto, 'auction-new') || '';
        } else if (isHttpUrl(prizePhoto)) {
          photoPath = prizePhoto.trim();
        } else if (typeof prizePhoto === 'string' && prizePhoto.startsWith('/uploads/')) {
          photoPath = prizePhoto.trim();
        }
      }

      // Sovg'a akkaunti haqidagi to'liq qo'shimcha ma'lumot
      let detailsObj = {};
      if (prizeDetails && typeof prizeDetails === 'object' && !Array.isArray(prizeDetails)) {
        for (const [k, v] of Object.entries(prizeDetails)) {
          const key = String(k).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
          if (!key) continue;
          const val = typeof v === 'string' ? v.slice(0, 1000) : (typeof v === 'number' || typeof v === 'boolean' ? v : null);
          if (val !== null && val !== '') detailsObj[key] = val;
        }
      }

      // Avvalgi FAOL auksionni yopishdan oldin barcha ishtirokchilarga
      // to'liq refund вЂ” aks holda ularning pullari yo'qolib ketardi.
      const activeRows = await prisma.$queryRawUnsafe("SELECT id FROM auctions WHERE status = 'ACTIVE'");
      if (activeRows && activeRows.length > 0) {
        for (const a of activeRows) {
          const bidders = await prisma.$queryRawUnsafe(`
            SELECT user_id, SUM(amount)::int as total_bid
            FROM auction_bids WHERE auction_id = $1 GROUP BY user_id
          `, a.id);
          for (const b of bidders) {
            const refAmt = Number(b.total_bid);
            if (refAmt > 0) {
              await prisma.$executeRawUnsafe(
                "UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2",
                refAmt, b.user_id
              );
            }
          }
          await prisma.$executeRawUnsafe(
            "UPDATE auctions SET status = 'CANCELLED', ends_at = NOW() WHERE id = $1 AND status = 'ACTIVE'",
            a.id
          );
        }
      }

      const rows = await prisma.$queryRawUnsafe(`
        INSERT INTO auctions (
          creator_id, title, instagram_username, instagram_url, instagram_avatar, audience_size,
          description, note, starting_price, min_step, current_bid, ends_at, duration_hours,
          admin_telegram_id, admin_name, admin_username, currency, status, prize_photo, prize_details
        )
        VALUES (
          1, $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $8, $10, $11,
          8897050018, 'Bexruz', 'bexruz_admin', 'UZS', 'ACTIVE', $12, $13::jsonb
        )
        RETURNING *
      `, 
        title || `Reels Collab / @${cleanUsername} hammualliflik sloti`,
        cleanUsername,
        directUrl,
        defaultAvatar,
        audText,
        description || `Instagram @${cleanUsername} akkauntida hammualliflik (Collab) sloti. Yutgan ishtirokchining reels videosi 24 soat davomida joylanadi.`,
        note || `1. Video sifatli va qoidabuzarliklarsiz bo'lishi shart.\n2. Yutgan shaxs admin bilan bog'lanib videoni taqdim etadi.`,
        sPrice,
        mStep,
        endsAt,
        hours,
        photoPath,
        JSON.stringify(detailsObj)
      );

      // Announce via Telegram bot if available
      try {
        const bot = getBot ? getBot() : null;
        if (bot) {
          const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const announceMsg = `рџ”Ґ <b>YANGI COLLAB AUKSIONI BOSHLANDI!</b>\n\n` +
                              `рџ“Њ <b>Akkaunt:</b> @${esc(cleanUsername)}\n` +
                              (audText ? `рџ‘Ґ <b>Qamrov:</b> ${esc(audText)}\n` : '') +
                              `рџ’° <b>Boshlang'ich narx:</b> ${sPrice.toLocaleString('uz-UZ')} UZS\n` +
                              `вЏ± <b>Davomiyligi:</b> ${hours} soat\n\n` +
                              `рџ‘‡ <b>Stavka qo'yish uchun pastdagi tugmani bosing:</b>`;
          // Send to admin first
          await bot.sendMessage('8897050018', announceMsg, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: "рџ”Ґ Auksion arenasiga kirish", web_app: { url: "https://topsxema.duckdns.org/marketplace?tab=auction" } }]
              ]
            }
          }).catch(() => {});
        }
      } catch (annErr) {}

      res.json({ 
        success: true, 
        auction: cleanJson(rows[0]), 
        message: "Auksion muvaffaqiyatli yaratildi va ishga tushirildi!" 
      });
    } catch (e) {
      console.error("POST /api/auctions error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6b. End Auction Forcefully by Admin (POST /api/auctions/:id/end)
  app.post('/api/auctions/:id/end', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { adminTgId } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }

      const aucRows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!aucRows || aucRows.length === 0) return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      const auc = aucRows[0];

      // Get highest bidder
      const topBid = await prisma.$queryRawUnsafe(`
        SELECT * FROM auction_bids WHERE auction_id = $1 ORDER BY amount DESC, created_at ASC LIMIT 1
      `, id);

      let winnerTgId = null;
      let winnerName = '';
      let winnerAvatar = '';

      if (topBid && topBid.length > 0) {
        winnerTgId = topBid[0].telegram_id;
        winnerName = topBid[0].user_name;
        winnerAvatar = topBid[0].user_avatar;
      }

      // Atomik status o'tishi: faqat ACTIVE auksion yakunlanadi.
      // (Aks holda /end ni 2 marta bosilsa yo'qotganlarga 2 marta refund ketardi)
      // winner_visible_until — g'olib kartasi 60 daqiqa ko'rinadi (X bosilmaguncha).
      const transitioned = await prisma.$executeRawUnsafe(`
        UPDATE auctions
        SET status = 'COMPLETED', winner_telegram_id = $1, winner_name = $2, winner_avatar = $3,
            ends_at = NOW(), winner_visible_until = NOW() + INTERVAL '60 minutes',
            winner_dismissed = FALSE, updated_at = NOW()
        WHERE id = $4 AND status = 'ACTIVE'
      `, winnerTgId, winnerName, winnerAvatar, id);

      if (!transitioned) {
        return res.status(409).json({ success: false, error: 'Auksion allaqachon yakunlangan yoki bekor qilingan' });
      }

      // Refund losers
      if (winnerTgId) {
        const losers = await prisma.$queryRawUnsafe(`
          SELECT user_id, telegram_id, SUM(amount)::int as total_bid
          FROM auction_bids
          WHERE auction_id = $1 AND telegram_id != $2
          GROUP BY user_id, telegram_id
        `, id, winnerTgId);

        for (const l of losers) {
          const refAmt = Number(l.total_bid);
          if (refAmt > 0) {
            await prisma.$executeRawUnsafe(`
              UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2
            `, refAmt, l.user_id);
          }
        }
      }

      res.json({ success: true, message: `Auksion yakunlandi! G'olib: ${winnerName || 'Aniqlanmadi'}` });
    } catch (e) {
      console.error("POST /api/auctions/:id/end error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6c. Cancel Auction by Admin (POST /api/auctions/:id/cancel)
  app.post('/api/auctions/:id/cancel', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { adminTgId } = req.body;
      if (String(adminTgId) !== '8897050018') return res.status(403).json({ success: false, error: 'Faqat admin uchun' });

      // Atomik: faqat ACTIVE auksion bekor qilinadi (takroran refund oldini oladi)
      const cancelled = await prisma.$executeRawUnsafe(
        "UPDATE auctions SET status = 'CANCELLED' WHERE id = $1 AND status = 'ACTIVE'", id
      );

      if (!cancelled) {
        return res.status(409).json({ success: false, error: 'Auksion allaqachon yopilgan' });
      }

      // Refund all bidders
      const allBidders = await prisma.$queryRawUnsafe(`
        SELECT user_id, telegram_id, SUM(amount)::int as total_bid
        FROM auction_bids
        WHERE auction_id = $1
        GROUP BY user_id, telegram_id
      `, id);

      for (const b of allBidders) {
        const refAmt = Number(b.total_bid);
        if (refAmt > 0) {
          await prisma.$executeRawUnsafe(`
            UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2
          `, refAmt, b.user_id);
        }
      }

      res.json({ success: true, message: "Auksion bekor qilindi va barcha stavkalar qaytarildi!" });
    } catch (e) {
      console.error("POST /api/auctions/:id/cancel error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6d. Update Auction (Admin) — tahrirlash
  app.post('/api/auctions/:id/update', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const {
        adminTgId, title, instagramUsername, instagramUrl, instagramAvatar,
        prizePhoto, prizeDetails, audienceSize, description, note,
        startingPrice, minStep, durationHours
      } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }

      const rows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!rows || rows.length === 0) return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      const auc = rows[0];

      const parts = [];
      const vals = [];
      const add = (col, val) => { vals.push(val); parts.push(`${col} = $${vals.length}`); };

      if (title !== undefined) add('title', String(title).slice(0, 255));
      if (instagramUsername !== undefined) add('instagram_username', String(instagramUsername).replace(/^@/, '').trim().slice(0, 255));
      if (instagramUrl !== undefined) add('instagram_url', String(instagramUrl).trim().slice(0, 500));
      if (instagramAvatar !== undefined) add('instagram_avatar', String(instagramAvatar).trim().slice(0, 500));
      if (audienceSize !== undefined) add('audience_size', String(audienceSize).trim().slice(0, 100));
      if (description !== undefined) add('description', String(description));
      if (note !== undefined) add('note', String(note));

      if (startingPrice !== undefined) {
        const sp = parseInt(startingPrice, 10);
        if (!Number.isFinite(sp) || sp < 0) return res.status(400).json({ success: false, error: 'Boshlang\'ich narx noto\'g\'ri' });
        add('starting_price', sp);
        if (auc.status === 'ACTIVE') add('current_bid', Math.max(sp, Number(auc.current_bid || 0)));
      }
      if (minStep !== undefined) {
        const ms = parseInt(minStep, 10);
        if (!Number.isFinite(ms) || ms < 0) return res.status(400).json({ success: false, error: 'Minimal qadam noto\'g\'ri' });
        add('min_step', ms);
      }
      if (durationHours !== undefined) {
        const hrs = parseFloat(durationHours);
        if (!Number.isFinite(hrs) || hrs <= 0) return res.status(400).json({ success: false, error: 'Davomiylilik noto\'g\'ri' });
        add('duration_hours', hrs);
        if (auc.status === 'ACTIVE') add('ends_at', new Date(Date.now() + hrs * 3600 * 1000));
      }
      if (prizePhoto !== undefined) {
        let photoPath = '';
        if (typeof prizePhoto === 'string' && prizePhoto.startsWith('data:')) {
          photoPath = savePrizePhoto(prizePhoto, `auction-${id}`) || '';
        } else if (isHttpUrl(prizePhoto)) {
          photoPath = String(prizePhoto).trim();
        } else if (typeof prizePhoto === 'string' && prizePhoto.startsWith('/uploads/')) {
          photoPath = String(prizePhoto).trim();
        }
        add('prize_photo', photoPath);
      }
      if (prizeDetails !== undefined) {
        let detailsObj = {};
        if (prizeDetails && typeof prizeDetails === 'object' && !Array.isArray(prizeDetails)) {
          for (const [k, v] of Object.entries(prizeDetails)) {
            const key = String(k).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
            if (!key) continue;
            const val = typeof v === 'string' ? v.slice(0, 1000) : (typeof v === 'number' || typeof v === 'boolean' ? v : null);
            if (val !== null && val !== '') detailsObj[key] = val;
          }
        }
        add('prize_details', JSON.stringify(detailsObj));
      }

      if (!parts.length) return res.status(400).json({ success: false, error: 'Tahrirlanadigan maydon topilmadi' });

      vals.push(id);
      const updated = await prisma.$queryRawUnsafe(
        `UPDATE auctions SET ${parts.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING *`,
        ...vals
      );

      res.json({ success: true, auction: cleanJson(updated[0]), message: 'Auksion ma\'lumotlari yangilandi!' });
    } catch (e) {
      console.error("POST /api/auctions/:id/update error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6e. Reopen Auction (Admin) — qayta ochish
  app.post('/api/auctions/:id/reopen', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { adminTgId, durationHours } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }

      const rows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!rows || rows.length === 0) return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      const auc = rows[0];

      if (auc.status === 'ACTIVE') {
        return res.status(409).json({ success: false, error: 'Bu auksion allaqachon faol' });
      }

      const hrs = parseFloat(durationHours) > 0 ? parseFloat(durationHours) : Number(auc.duration_hours || 2);
      const endsAt = new Date(Date.now() + hrs * 3600 * 1000);

      // Eski stavkalar qaytarilgan bo'lsa — ularni tozalaymiz (qayta refund bo'lmasligi uchun)
      await prisma.$executeRawUnsafe("DELETE FROM auction_bids WHERE auction_id = $1", id);

      const updated = await prisma.$queryRawUnsafe(`
        UPDATE auctions
        SET status = 'ACTIVE',
            ends_at = $1,
            duration_hours = $2,
            current_bid = starting_price,
            current_winner_id = NULL,
            winner_telegram_id = NULL,
            winner_name = '',
            winner_avatar = '',
            notified_5min = FALSE,
            notified_winner = FALSE,
            winner_visible_until = NULL,
            winner_dismissed = FALSE,
            refunded_at = NULL,
            updated_at = NOW()
        WHERE id = $3
        RETURNING *
      `, endsAt, hrs, id);

      res.json({ success: true, auction: cleanJson(updated[0]), message: 'Auksion qayta ochildi!' });
    } catch (e) {
      console.error("POST /api/auctions/:id/reopen error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6f. Refund Auction (Admin) — barcha stavkalarni qaytarish
  app.post('/api/auctions/:id/refund', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { adminTgId } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }

      const rows = await prisma.$queryRawUnsafe("SELECT * FROM auctions WHERE id = $1", id);
      if (!rows || rows.length === 0) return res.status(404).json({ success: false, error: 'Auksion topilmadi' });
      const auc = rows[0];

      if (auc.refunded_at) {
        return res.status(409).json({ success: false, error: 'Bu auksion uchun pul allaqachon qaytarilgan' });
      }

      const bidders = await prisma.$queryRawUnsafe(`
        SELECT user_id, telegram_id, SUM(amount)::int as total_bid
        FROM auction_bids
        WHERE auction_id = $1
        GROUP BY user_id, telegram_id
      `, id);

      let totalRefunded = 0;
      let count = 0;
      for (const b of bidders) {
        const refAmt = Number(b.total_bid || 0);
        if (refAmt <= 0) continue;
        const walletRows = await prisma.$queryRawUnsafe('SELECT id FROM wallets WHERE user_id = $1', b.user_id);
        if (!walletRows || !walletRows.length) continue;
        await prisma.$executeRawUnsafe(`
          UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2
        `, refAmt, b.user_id);
        try {
          await prisma.$executeRawUnsafe(`
            INSERT INTO transactions (wallet_id, type, amount, status, note, created_at)
            VALUES ($1, 'AUCTION_REFUND', $2, 'COMPLETED', $3, NOW())
          `, walletRows[0].id, refAmt, `Auksion #${id} — admin refund`);
        } catch (tErr) {}
        totalRefunded += refAmt;
        count++;
      }

      await prisma.$executeRawUnsafe(`
        UPDATE auctions
        SET refunded_at = NOW(),
            status = CASE WHEN status = 'ACTIVE' THEN 'CANCELLED' ELSE status END,
            updated_at = NOW()
        WHERE id = $1
      `, id);

      res.json({
        success: true,
        refundedUsers: count,
        totalRefunded,
        message: count
          ? `${count} ta foydalanuvchiga jami ${totalRefunded.toLocaleString('uz-UZ')} UZS qaytarildi`
          : 'Qaytariladigan stavka topilmadi'
      });
    } catch (e) {
      console.error("POST /api/auctions/:id/refund error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6g. G'olib kartasini yashirish (60 daqiqa o'tdi yoki admin X bosdi)
  app.post('/api/auctions/:id/dismiss-winner', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { adminTgId } = req.body;
      if (String(adminTgId) !== '8897050018') {
        return res.status(403).json({ success: false, error: 'Faqat admin uchun' });
      }
      await prisma.$executeRawUnsafe(`
        UPDATE auctions SET winner_dismissed = TRUE, updated_at = NOW() WHERE id = $1
      `, id);
      res.json({ success: true, message: 'G\'olib kartasi yashirildi' });
    } catch (e) {
      console.error("POST /api/auctions/:id/dismiss-winner error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 7. Check Permissions
  app.get('/api/auctions/permissions/check/:telegramId', async (req, res) => {
    try {
      const { telegramId } = req.params;
      const isAdmin = String(telegramId) === '8897050018';
      if (isAdmin) return res.json({ success: true, canCreate: true, isAdmin: true });

      const rows = await prisma.$queryRawUnsafe('SELECT 1 FROM auction_permissions WHERE telegram_id = $1', BigInt(telegramId));
      res.json({ success: true, canCreate: rows && rows.length > 0, isAdmin: false });
    } catch (e) {
      if (e instanceof SyntaxError) {
        return res.status(400).json({ success: false, error: 'Telegram ID noto\'g\'ri' });
      }
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/auctions/permissions', async (_req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe('SELECT * FROM auction_permissions ORDER BY id DESC');
      res.json({ success: true, permissions: cleanJson(rows) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post('/api/auctions/permissions', async (req, res) => {
    try {
      const { adminTgId, targetTelegramId, userName } = req.body;
      if (String(adminTgId) !== '8897050018') return res.status(403).json({ success: false, error: 'Faqat admin uchun' });

      let targetTg, adminTg;
      try {
        targetTg = BigInt(targetTelegramId);
        adminTg = BigInt(adminTgId);
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Telegram ID noto\'g\'ri' });
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO auction_permissions (user_id, telegram_id, user_name, granted_by)
        VALUES (1, $1, $2, $3)
        ON CONFLICT (telegram_id) DO NOTHING
      `, targetTg, (userName || '').trim().slice(0, 100), adminTg);

      res.json({ success: true, message: 'Ruxsat berildi!' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 7b. User Feedback & Ideas (Fikr va Takliflar)
  app.post('/api/demo/feedback', async (req, res) => {
    try {
      const { telegramId, userName, category, message } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ success: false, error: "Xabar matni kiritilishi shart" });
      }
      const cleanMsg = message.trim().slice(0, 1000);
      const allowedCats = ['Taklif', 'Fikr', 'Muammo'];
      const cat = allowedCats.includes(category) ? category : 'Taklif';
      const tgId = telegramId ? String(telegramId).slice(0, 64) : null;
      const uName = (userName || 'Foydalanuvchi').trim().slice(0, 100);

      await prisma.$executeRawUnsafe(`
        INSERT INTO user_feedbacks (telegram_id, user_name, category, message, created_at)
        VALUES ($1, $2, $3, $4, NOW())
      `, tgId, uName, cat, cleanMsg);

      const bot = typeof getBot === 'function' ? getBot() : null;
      if (bot) {
        try {
          const alert = `рџ’Ў <b>Yangi Fikr / Taklif keldi!</b>\n\n` +
                        `рџ‘¤ <b>Kimdan:</b> ${uName} (ID: <code>${tgId || 'N/A'}</code>)\n` +
                        `рџЏ· <b>Kategoriya:</b> ${cat}\n` +
                        `рџ’¬ <b>Matn:</b>\n${cleanMsg}`;
          await bot.sendMessage('8897050018', alert, { parse_mode: 'HTML' });
        } catch (bErr) {}
      }

      res.json({ success: true, message: "Fikringiz uchun tashakkur! Taklifingiz qabul qilindi." });
    } catch (e) {
      console.error("POST /api/demo/feedback error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/demo/feedback', async (_req, res) => {
    try {
      const rows = await prisma.$queryRawUnsafe(`
        SELECT id, telegram_id, user_name, category, message, created_at
        FROM user_feedbacks
        ORDER BY created_at DESC
        LIMIT 50
      `);
      res.json({ success: true, feedbacks: cleanJson(rows) });
    } catch (e) {
      console.error("GET /api/demo/feedback error:", e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 8. Background Scheduler (3-5 min notification & Auto-Finish)
  setInterval(async () => {
    try {
      const bot = typeof getBot === 'function' ? getBot() : null;
      const now = new Date();

      // Urgent alert (3 min ahead)
      const threeMinAhead = new Date(now.getTime() + 3 * 60 * 1000);
      const urgentAuctions = await prisma.$queryRawUnsafe(`
        SELECT * FROM auctions
        WHERE status = 'ACTIVE' 
          AND ends_at <= $1 
          AND ends_at > $2
          AND notified_5min = FALSE
      `, threeMinAhead, now);

      for (const auc of urgentAuctions) {
        await prisma.$executeRawUnsafe("UPDATE auctions SET notified_5min = TRUE WHERE id = $1", auc.id);
        if (bot) {
          const bidders = await prisma.$queryRawUnsafe(`
            SELECT DISTINCT telegram_id FROM auction_bids WHERE auction_id = $1
          `, auc.id);

          for (const b of bidders) {
            try {
              const msg = `вљЎ <b>Auksion tugashiga 3 daqiqa qoldi!</b>\n\n` +
                          `<b>${auc.title}</b> auksioni tez orada yakunlanadi!\n` +
                          `Hozirgi eng yuqori stavka: <b>${Number(auc.current_bid).toLocaleString('uz-UZ')} UZS</b>.\n\n` +
                          `G'olib bo'lish uchun stavkangizni oshiring!`;
              await bot.sendMessage(String(b.telegram_id), msg, {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: "рџ”Ґ Stavka qilish", web_app: { url: `https://topsxema.duckdns.org/marketplace?tab=auction` } }]
                  ]
                }
              });
            } catch (err) {}
          }
        }
      }

      // Auto-Finish completed auctions
      const finishedAuctions = await prisma.$queryRawUnsafe(`
        SELECT * FROM auctions
        WHERE status = 'ACTIVE' AND ends_at <= $1
      `, now);

      for (const auc of finishedAuctions) {
        // Find top bidder
        const topBid = await prisma.$queryRawUnsafe(`
          SELECT * FROM auction_bids WHERE auction_id = $1 ORDER BY amount DESC, created_at ASC LIMIT 1
        `, auc.id);

        let winTgId = null;
        let winName = '';
        let winAvatar = '';

        if (topBid && topBid.length > 0) {
          winTgId = topBid[0].telegram_id;
          winName = topBid[0].user_name;
          winAvatar = topBid[0].user_avatar;
        }

        await prisma.$executeRawUnsafe(`
          UPDATE auctions
          SET status = 'COMPLETED', winner_telegram_id = $1, winner_name = $2, winner_avatar = $3,
              winner_visible_until = NOW() + INTERVAL '60 minutes', winner_dismissed = FALSE,
              updated_at = NOW()
          WHERE id = $4
        `, winTgId, winName, winAvatar, auc.id);

        console.log(`рџЏ† Auction #${auc.id} completed. Winner: ${winName} (${winTgId})`);

        // Notify winner
        if (bot && winTgId) {
          try {
            const winMsg = `рџЋ‰ <b>TABRIKLAYMIZ! SIZ AUKSIONDA G'OLIB BO'LDINGIZ!</b>\n\n` +
                           `рџ“Њ <b>Akkaunt:</b> @${auc.instagram_username}\n` +
                           `рџ’° <b>G'olib stavka:</b> ${Number(auc.current_bid).toLocaleString('uz-UZ')} UZS\n` +
                           `рџ‘¤ <b>Auksion moderatori / Admin:</b> Bexruz (@bexruz_admin)\n\n` +
                           `Videongizni joylash uchun moderator bilan bog'laning!`;
            await bot.sendMessage(String(winTgId), winMsg, { parse_mode: 'HTML' });
          } catch (e) {}
        }

        // Refund losers
        if (winTgId) {
          const losers = await prisma.$queryRawUnsafe(`
            SELECT user_id, telegram_id, SUM(amount)::int as total_bid
            FROM auction_bids
            WHERE auction_id = $1 AND telegram_id != $2
            GROUP BY user_id, telegram_id
          `, auc.id, winTgId);

          for (const loser of losers) {
            const refundAmt = Number(loser.total_bid);
            if (refundAmt > 0) {
              await prisma.$executeRawUnsafe(`
                UPDATE wallets SET balance = balance + $1, updated_at = NOW() WHERE user_id = $2
              `, refundAmt, loser.user_id);

              if (bot && loser.telegram_id) {
                const refundMsg = `рџ’° <b>Mablag'ingiz hisobingizga qaytarildi!</b>\n\n` +
                                  `<b>${auc.title}</b> auksioni yakunlandi.\n` +
                                  `Stavka qilingan <b>${refundAmt.toLocaleString('uz-UZ')} UZS</b> balansingizga to'liq 100% qaytarildi.`;
                await bot.sendMessage(String(loser.telegram_id), refundMsg, { parse_mode: 'HTML' }).catch(() => {});
              }
            }
          }
        }
      }
    } catch (schedErr) {
      console.error("Auction scheduler error:", schedErr.message);
    }
  }, 20000);
}
