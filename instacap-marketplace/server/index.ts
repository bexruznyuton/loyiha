import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { handleDemo } from "./routes/demo";
import { handleInstagramCaption } from "./routes/instagram-single";
import { handleInstagramScrape } from "./routes/instagram-caption";
import { handleTrackEvent } from "./routes/analytics";
import { handleAuthValidate } from "./routes/auth";
import { handleGetProfile, handleGetHistory, handleDeleteHistory } from "./routes/user";
import { authMiddleware, optionalAuthMiddleware } from "./middleware/auth";
import { connectDB } from "./db";
import { initBot } from "./bot";
import { saveAsBotPool } from "./saveasbot";

// Marketplace — STATIK import (createServer() sinxron tugashi kerak, aks holda
// node-build.ts dagi catch-all 404 marketplace route'lardan oldin ro'yxatga olinadi).
import * as marketplaceAccounts from "./routes/marketplace/accounts";
import * as marketplaceOrders from "./routes/marketplace/orders";
import * as marketplaceAdmin from "./routes/marketplace/admin";
import * as marketplaceWallet from "./routes/marketplace/wallet";
import { handlePreviewSubmitAccount } from "./routes/marketplace/preview";
import { handleUploadImage } from "./routes/upload-image";
import { handleGetFile } from "./routes/file-proxy";
import { handleGetWeeklyHashtag } from "./routes/weekly-hashtag";
import { handleBotForward, handleBotForwardText } from "./routes/bot-forward";
import { handleInstagramBio } from "./routes/instagram-bio";
import { handleSendBioToTelegram } from "./routes/bio-webapp";
import * as tagCampaign from "./routes/tag-campaign";
import { pgUserMiddleware, adminMiddleware } from "./lib/auth-pg";
import { prisma } from "./lib/prisma";
import { sendBotMessage } from "./bot-helpers";
import { getCommissionRate } from "./lib/marketplace-config";
import { fetchInstagramBioData } from "./routes/instagram-bio";
// Auksion moduli — alohida `auction.mjs` fayli (dist/server ichida turadi).
import { registerAuction } from "./auction.mjs";

// Rate limiter for Instagram API
const instagramLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 daqiqa
  max: 100, // Har bir IP uchun maksimal 100 ta so'rov
  message: {
    success: false,
    caption: '',
    error: 'Too many requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export function createServer() {
  const app = express();

  // Nginx reverse proxy orqasida ishlash uchun
  app.set('trust proxy', 1);

  // Middleware
  app.use(cors());
  // Default 100KB juda kichik — base64 rasmlar (avatar + 3 skrinshot) o'tmaydi.
  // Telegram bot uchun maksimal foto ~10MB, 4 ta uchun jami ~25-30MB yetadi.
  app.use(express.json({ limit: "30mb" }));
  app.use(express.urlencoded({ extended: true, limit: "30mb" }));

  // Public routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Auth routes (protected)
  app.post("/api/auth/validate", authMiddleware, handleAuthValidate);

  // User routes (protected)
  app.get("/api/user/profile", authMiddleware, handleGetProfile);
  app.get("/api/user/history", authMiddleware, handleGetHistory);
  app.delete("/api/user/history/:id", authMiddleware, handleDeleteHistory);

  // Instagram routes (optional auth — auth bor bo'lsa tarixga saqlaydi)
  app.post("/api/instagram-caption", instagramLimiter, optionalAuthMiddleware, handleInstagramCaption);
  app.post("/api/instagram-scrape", instagramLimiter, handleInstagramScrape);

  // Analytics tracking
  app.post("/api/track-event", handleTrackEvent);

  // Image upload (marketplace e'lon uchun) — auth + pgUser kerak
  app.post("/api/upload-image", authMiddleware, pgUserMiddleware, handleUploadImage);
  // Telegram file proxy (avatar/skrinshot ko'rsatish uchun)
  app.get("/api/files/:fileId", handleGetFile);
  // Haftalik xeshteg (admin tomonidan bot orqali yangilanadi)
  app.get("/api/weekly-hashtag", handleGetWeeklyHashtag);
  // PHP bot.php bridge — Top_sxema_instagrambot callback'larini PHP'dan VPS'ga forward.
  app.post("/api/bot-forward", handleBotForward);
  app.post("/api/bot-forward/text", handleBotForwardText);
  // Instagram profil bio'sini olish (ochiq, login shart emas) — bot.php "Bio yuklash" tugmasi shu yerdan chaqiradi.
  app.get("/api/instagram-bio", handleInstagramBio);
  app.post("/api/bio/send-telegram", authMiddleware, handleSendBioToTelegram);

  // ===== Marketplace routes (sinxron — catch-all'dan oldin) =====
  // Preview/demo submit — AUTH talab QILMAYDI, faqat admin'larga bot xabari
  app.post("/api/marketplace/preview-submit", handlePreviewSubmitAccount);
  // Accounts
  app.get("/api/marketplace/accounts", marketplaceAccounts.handleListAccounts);
  app.get("/api/marketplace/accounts/:id", marketplaceAccounts.handleGetAccount);
  app.post("/api/marketplace/accounts", authMiddleware, pgUserMiddleware, marketplaceAccounts.handleCreateAccount);
  app.get("/api/marketplace/my/accounts", authMiddleware, pgUserMiddleware, marketplaceAccounts.handleListMyAccounts);
  app.put("/api/marketplace/my/accounts/:id", authMiddleware, pgUserMiddleware, marketplaceAccounts.handleUpdateMyAccount);
  app.post("/api/marketplace/my/accounts/:id/edit-request", authMiddleware, pgUserMiddleware, marketplaceAccounts.handleRequestAccountEdit);
  // Orders
  app.post("/api/marketplace/orders", authMiddleware, pgUserMiddleware, marketplaceOrders.handleCreateOrder);
  app.post("/api/marketplace/orders/:id/pay", authMiddleware, pgUserMiddleware, marketplaceOrders.handleMockPayOrder);
  app.post("/api/marketplace/orders/:id/accept", authMiddleware, pgUserMiddleware, marketplaceOrders.handleAcceptOrder);
  app.post("/api/marketplace/orders/:id/posted", authMiddleware, pgUserMiddleware, marketplaceOrders.handleMarkPosted);
  app.post("/api/marketplace/orders/:id/complete", authMiddleware, pgUserMiddleware, marketplaceOrders.handleCompleteOrder);
  app.post("/api/marketplace/orders/:id/dispute", authMiddleware, pgUserMiddleware, marketplaceOrders.handleDisputeOrder);
  app.post("/api/marketplace/orders/:id/cancel", authMiddleware, pgUserMiddleware, marketplaceOrders.handleCancelOrder);
  app.get("/api/marketplace/my/orders", authMiddleware, pgUserMiddleware, marketplaceOrders.handleListMyOrders);
  // Wallet
  app.get("/api/marketplace/wallet", authMiddleware, pgUserMiddleware, marketplaceWallet.handleGetWallet);
  app.post("/api/marketplace/wallet/topup", authMiddleware, pgUserMiddleware, marketplaceWallet.handleCreateTopup);
  app.post("/api/marketplace/wallet/topup/checkout", authMiddleware, pgUserMiddleware, marketplaceWallet.handleCreateTopupCheckout);
  app.post("/api/marketplace/wallet/topup/checkout/:id/check", authMiddleware, pgUserMiddleware, marketplaceWallet.handleCheckTopupCheckout);
  app.post("/api/marketplace/wallet/topup/stars", authMiddleware, pgUserMiddleware, marketplaceWallet.handleCreateTopupStars);
  app.post("/api/marketplace/wallet/topup/stars/:id/check", authMiddleware, pgUserMiddleware, marketplaceWallet.handleCheckTopupStars);
  app.post("/api/marketplace/wallet/payout", authMiddleware, pgUserMiddleware, marketplaceWallet.handleRequestPayout);
  // Admin
  app.get("/api/marketplace/admin/accounts/pending", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminListPendingAccounts);
  app.post("/api/marketplace/admin/accounts/:id/verify", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminVerifyAccount);
  app.get("/api/marketplace/admin/payouts", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminListPayouts);
  app.post("/api/marketplace/admin/payouts/:id/approve", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminApprovePayout);
  app.post("/api/marketplace/admin/payouts/:id/reject", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminRejectPayout);
  app.get("/api/marketplace/admin/disputes", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminListDisputes);
  app.post("/api/marketplace/admin/disputes/:id/resolve", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminResolveDispute);
  app.get("/api/marketplace/admin/stats", authMiddleware, pgUserMiddleware, adminMiddleware, marketplaceAdmin.handleAdminStats);
  registerAuction(app, {
    authMiddleware,
    pgUserMiddleware,
    adminMiddleware,
    prisma,
    sendBotMessage,
    getCommissionRate,
    fetchInstagramBioData,
  });
  console.log("✅ Marketplace routes mounted (sync)");

  // Atmetka qilish kampaniyasi ("Profile" sahifasidagi yangi tugma)
  app.get("/api/tag-campaign/config", tagCampaign.handleGetTagCampaignConfig);
  app.post("/api/tag-campaign/check", authMiddleware, pgUserMiddleware, tagCampaign.handleCheckTagVideo);
  app.post("/api/tag-campaign/submit", authMiddleware, pgUserMiddleware, tagCampaign.handleSubmitTagVideo);
  app.get("/api/tag-campaign/my", authMiddleware, pgUserMiddleware, tagCampaign.handleListMyTagSubmissions);
  app.get("/api/tag-campaign/csgo-config", tagCampaign.handleGetCsgoConfig);
  app.post("/api/tag-campaign/csgo-submit", authMiddleware, pgUserMiddleware, tagCampaign.handleCsgoSubmit);

  // MongoDB ga ulanish va Telegram Bot ni ishga tushirish
  connectDB();
  initBot();

  // @SaveAsBot session pool — fonda yuklaymiz, server boshlanishini bloklamaydi
  saveAsBotPool.init().catch((err) => {
    console.error("SaveAsBot pool init failed:", err);
  });

  // Marketplace order release cron — 24 soat o'tgan BUYER_VERIFIED orderlarni
  // COMPLETED ga o'tkazadi va seller wallet'ini kreditlaydi.
  import("./lib/order-release-cron").then((m) => m.startOrderReleaseCron()).catch((e) => {
    console.error("order-release-cron start failed:", e);
  });

  // Havola kutayotgan buyurtmalar — xaridor/sotuvchiga 3 / 30 / 60 daqiqalik eslatmalar.
  import("./lib/order-reminder-cron").then((m) => m.startOrderReminderCron()).catch((e) => {
    console.error("order-reminder-cron start failed:", e);
  });

  // checkout.uz hamyon to'ldirish poller — PENDING to'lovlarni har 20 soniyada
  // tekshiradi va to'langanlarini avtomatik kreditlaydi (bot.php'dagi
  // `?update=limitpay` cron'iga teng, lekin tashqi cron shart emas).
  marketplaceWallet.startCheckoutUzTopupPoller();

  // Atmetka qilish kampaniyasi — kuniga 4 marta prosmotr/atmetka tekshiruvi.
  import("./lib/tag-campaign-cron").then((m) => m.startTagCampaignCron()).catch((e) => {
    console.error("tag-campaign-cron start failed:", e);
  });

  return app;
}
