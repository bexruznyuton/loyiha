import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import {
  getDailyStats,
  getWeeklyStats,
  getAllTimeStats,
  getHourlyDistribution,
  getPeakHour,
  getVideoStats,
  getVideoHourlyDistribution,
  getBioStats,
} from './analytics';
import { User } from './models/User';
import { SurveyResponse } from './models/SurveyResponse';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// Foydalanuvchi-tomon bot (Top_sxema_instagrambot) — seller'lar va buyer'lar bilan bog'lanish uchun.
// Admin tasdiqlash (mediaGroup + tugmalar) faqat asosiy bot'da (insaybbot).
const SELLER_BOT_TOKEN = process.env.WEBAPP_BOT_TOKEN || '';
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map(id => parseInt(id.trim()));
const WEBAPP_URL = process.env.WEBAPP_URL || '';
// Telegram WebView HTML'ni domen bo'yicha keshlaydi — WebApp'ga sezilarli
// o'zgarish (masalan Atmetka/CS GO tizimi kabi) kirganda shu raqamni
// oshiring (bump), aks holda foydalanuvchilar ESKI keshlangan sahifani
// ko'rishda davom etadi (2026-09-30 aniqlangan bug).
const WEBAPP_URL_V = WEBAPP_URL ? `${WEBAPP_URL}?v=4` : '';

// Video analiz kunlik limiti — vidoctorai xizmati shu fayldan o'qiydi (0 = cheksiz)
const VIDEO_LIMIT_FILE = process.env.VIDEO_LIMIT_CONFIG || '/var/www/vidoctorai/limit_config.json';

function getVideoLimit(): number {
  try {
    const v = JSON.parse(fs.readFileSync(VIDEO_LIMIT_FILE, 'utf-8')).daily_limit;
    return Number.isFinite(v) ? v : 1;
  } catch {
    return 1;
  }
}

function setVideoLimit(n: number): void {
  fs.writeFileSync(VIDEO_LIMIT_FILE, JSON.stringify({ daily_limit: n }));
}

let bot: TelegramBot | null = null;
let sellerBot: TelegramBot | null = null;

// So'rovnoma savollari
const SURVEY_POLLS = [
  {
    question: "Videolaringiz topga chiqarishni qanchalik xohlaysiz?",
    options: ["Unchalik qiziq emas", "O'rtacha", "Juda yam"],
  },
  {
    question: "Videolaringizni topga chiqarish uchun sizga o'xshagan insonlarga yordam bergan bo'larmidingiz?",
    options: ["Ha, farqi yo'q", "Yo'q, qiziq emas"],
  },
];

// Poll ID → kontekst xaritasi (in-memory)
const activePollMap = new Map<string, {
  telegramId: number;
  chatId: number;
  pollIndex: number;
  question: string;
  options: string[];
  createdAt: number;
}>();

// Eski poll yozuvlarni tozalash (1 soatdan eski)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [pollId, context] of activePollMap.entries()) {
    if (context.createdAt < oneHourAgo) {
      activePollMap.delete(pollId);
    }
  }
}, 30 * 60 * 1000);

// Stats keyboard (admin statistika tugmalari)
// Professional UX: 2-ustun grid, mantiqiy guruhlangan
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📊 Bugun', callback_data: 'stats' },
        { text: '📈 7 kun', callback_data: 'weekly' },
        { text: '🗂 Umumiy', callback_data: 'all_time' },
      ],
      [
        { text: '⏰ Soatlik', callback_data: 'hourly' },
        { text: '🔥 Pik soat', callback_data: 'peak' },
      ],
      [
        { text: '🎬 Video Analiz', callback_data: 'video_stats' },
      ],
      [
        { text: '🏪 Marketplace statistika', callback_data: 'mkt_stats_hub' },
      ],
      [
        { text: '🔖 Heshteg boshqaruv', callback_data: 'heshteg_back' },
        { text: '📋 So\'rovnoma', callback_data: 'survey_stats' },
      ],
      [
        { text: '🔄 Yangilash', callback_data: 'refresh' },
      ],
    ]
  }
};

// So'rovnoma statistika keyboard
const surveyKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '👥 Javoblar ro\'yxati', callback_data: 'survey_responses' }
      ],
      [
        { text: '⬅️ Orqaga', callback_data: 'survey_back' }
      ]
    ]
  }
};

// So'rovnoma javoblar keyboard
const surveyResponsesKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📋 Statistika', callback_data: 'survey_stats' }
      ],
      [
        { text: '⬅️ Orqaga', callback_data: 'survey_back' }
      ]
    ]
  }
};

// So'rovnoma poll yuborish
async function sendSurveyPoll(chatId: number, pollIndex: number): Promise<void> {
  const poll = SURVEY_POLLS[pollIndex];
  if (!poll || !bot) return;

  // Agar allaqachon javob berilgan bo'lsa, keyingisiga o'tish
  const existing = await SurveyResponse.findOne({ telegramId: chatId, pollIndex });
  if (existing) {
    if (pollIndex === 0) {
      await sendSurveyPoll(chatId, 1);
    } else {
      await User.updateOne({ telegramId: chatId }, { $set: { surveyCompleted: true } });
      await sendWebAppButton(chatId);
    }
    return;
  }

  const sentMessage = await bot.sendPoll(chatId, poll.question, poll.options, {
    is_anonymous: false,
    type: 'regular',
  });

  if (sentMessage.poll) {
    activePollMap.set(sentMessage.poll.id, {
      telegramId: chatId,
      chatId,
      pollIndex,
      question: poll.question,
      options: poll.options,
      createdAt: Date.now(),
    });
  }
}

// WebApp tugmasini yuborish
async function sendWebAppButton(chatId: number): Promise<void> {
  if (!WEBAPP_URL) {
    bot?.sendMessage(chatId, '⚠️ Dastur hozircha mavjud emas. Keyinroq qayta urinib ko\'ring.');
    return;
  }

  bot?.sendMessage(chatId,
    'So\'rovnomaga javob berganingiz uchun rahmat! Bot tomonidan sizga xabar yuboramiz.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔖 Heshteg yuklash', web_app: { url: WEBAPP_URL_V } }]
        ]
      }
    }
  );
}

export function initBot() {
  if (!BOT_TOKEN) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set. Bot will not start.');
    return;
  }

  if (ADMIN_IDS.length === 0 || !ADMIN_IDS[0]) {
    console.warn('⚠️  ADMIN_TELEGRAM_IDS not set. Bot will not start.');
    return;
  }

  try {
    bot = new TelegramBot(BOT_TOKEN, {
      polling: {
        interval: 1000,
        autoStart: true,
        params: {
          timeout: 10
        }
      },
      // MUHIM: Telegram'ning uzoq-so'rov (`params.timeout=10s`) javob
      // bermay, ulanish "osilib" qolishi mumkin — bunda kutubxona HECH
      // QANDAY xato bermay ABADIY kutadi (haqiqiy production'da tasdiqlangan:
      // 44 soat process "online" turgan, lekin botga hech qanday xabar
      // javob bermagan). `request.timeout` shu HTTP so'rovning o'zini
      // majburan uzadi — shundan keyingina 'polling_error' chiqadi va
      // pastdagi self-heal (5 marta ketma-ket xato → majburiy qayta
      // ulanish) ishga tushadi.
      // @types/node-telegram-bot-api'dagi `request` turi `request` kutubxonasining
      // to'liq Options interfeysini talab qiladi (masalan `uri` majburiy) —
      // amalda esa kutubxona buni faqat qisman merge qiladi, shuning uchun
      // `as any` xavfsiz.
      request: {
        timeout: 20000,
      } as any,
    });

    console.log('✅ Telegram bot started successfully');

    // Chat input yonidagi "Menu" tugmasini "🔖 Heshteg yuklash" → WebApp ga o'rnatamiz.
    // Ikkala bot uchun ham (insy + Top_sxema). Top_sxema polling yoq bo'lsa ham
    // raw HTTP orqali set qilamiz — bu BotFather darajasidagi default tugmani almashtiradi.
    if (WEBAPP_URL) {
      const setMenuViaApi = async (token: string, label: string, text: string) => {
        try {
          const res = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ menu_button: { type: 'web_app', text, web_app: { url: WEBAPP_URL } } }),
          });
          const json = await res.json() as { ok: boolean; description?: string };
          if (json.ok) console.log(`✅ ${label}: chat menu button → ${text}`);
          else console.warn(`${label} setChatMenuButton: ${json.description}`);
        } catch (e) {
          console.warn(`${label} setChatMenuButton failed:`, e instanceof Error ? e.message : e);
        }
      };
      setMenuViaApi(BOT_TOKEN, '@insaybbot', '🔖 Heshteg yuklash');
      if (SELLER_BOT_TOKEN && SELLER_BOT_TOKEN !== BOT_TOKEN) {
        // Top_sxema'da ikonka (emoji)siz, faqat matn — mijoz talabi (2026-10-02).
        setMenuViaApi(SELLER_BOT_TOKEN, '@Top_sxema_instagrambot', 'Heshteg yuklash');
      }
    }

    // Seller-tomon bot (Top_sxema_instagrambot) — faqat ENABLE_SELLER_BOT=1 bo'lganda
    // polling boshlaymiz. Aks holda eski xosting bilan polling konflikti bo'ladi
    // (Telegram bitta token uchun bitta polling'ga ruxsat beradi).
    // Hozircha o'chiq: owner xabarlari insaybbot orqali yuboriladi (getSellerBot() → fallback bot).
    if (process.env.ENABLE_SELLER_BOT === '1' && SELLER_BOT_TOKEN && SELLER_BOT_TOKEN !== BOT_TOKEN) {
      try {
        sellerBot = new TelegramBot(SELLER_BOT_TOKEN, {
          polling: { interval: 1000, autoStart: true, params: { timeout: 10 } },
          request: { timeout: 20000 } as any,
        });
        console.log('✅ Seller bot (Top_sxema_instagrambot) started');
      } catch (err) {
        console.warn('⚠️  Seller bot start failed:', err instanceof Error ? err.message : err);
        sellerBot = null;
      }
    } else {
      console.log('ℹ️  Seller bot disabled (ENABLE_SELLER_BOT != 1) — owner xabarlari asosiy bot orqali yuboriladi');
    }

    // Marketplace bot inline handler'lari — fonda ulanadi.
    import('./bot-marketplace').then(({ initMarketplaceBot }) => {
      if (bot) {
        try {
          initMarketplaceBot(bot, sellerBot);
          console.log('✅ Marketplace bot handlers registered');
        } catch (err) {
          console.warn('⚠️  initMarketplaceBot failed:', err instanceof Error ? err.message : err);
        }
      }
    }).catch((err) => {
      console.warn('⚠️  bot-marketplace yuklanmadi (prisma?):', err instanceof Error ? err.message : err);
    });

    // Preview demo bot handler'lari (mkt:preview:* — tasdiq/rad/narx)
    import('./routes/marketplace/preview').then(({ initPreviewBot }) => {
      if (bot) {
        try { initPreviewBot(bot); } catch (err) {
          console.warn('⚠️  initPreviewBot failed:', err instanceof Error ? err.message : err);
        }
      }
    }).catch((err) => {
      console.warn('⚠️  preview bot yuklanmadi:', err instanceof Error ? err.message : err);
    });

    // Error handling — node-telegram-bot-api ba'zan tarmoq xatosidan keyin
    // (ECONNRESET/ETIMEDOUT) polling siklini JIM o'ldirib qo'yadi va o'zi
    // hech qachon qayta urinib ko'rmaydi (kutubxonaning ma'lum kamchiligi).
    // Natijada bot "ishlamay qoladi" — Telegram tomonida yangilanishlar
    // to'planib qoladi (getWebhookInfo'dagi pending_update_count o'smasdan
    // qotib qoladi), lekin process o'zi ishlab turgani uchun pm2 buni
    // pastdagi crash sifatida ko'rmaydi. Shu sabab qisqa vaqt ichida ko'p
    // xato bo'lsa, pollingni MAJBURIY to'xtatib qayta ishga tushiramiz.
    let pollingErrorCount = 0;
    let lastPollingErrorAt = 0;
    bot.on('polling_error', (error) => {
      console.error('❌ Polling error:', error.message);
      const now = Date.now();
      if (now - lastPollingErrorAt > 60_000) pollingErrorCount = 0;
      lastPollingErrorAt = now;
      pollingErrorCount++;
      if (pollingErrorCount >= 5) {
        pollingErrorCount = 0;
        console.warn('⚠️  Polling 5+ marta ketma-ket xato berdi — majburan qayta ishga tushirilmoqda...');
        bot!.stopPolling()
          .then(() => bot!.startPolling())
          .then(() => console.log('✅ Polling qayta tiklandi'))
          .catch((e) => console.error('❌ Pollingni qayta ishga tushirib bo\'lmadi:', e instanceof Error ? e.message : e));
      }
    });

    bot.on('error', (error) => {
      console.error('❌ Bot error:', error.message);
    });

    // Admin uchun DOIMIY (resize) pastki tugmalar menyusi — hech qanday
    // slash-komanda kerak emas, hammasi shu tugmalar + ular ochadigan inline
    // panellar orqali ishlaydi (Top_sxema step tizimiga o'xshab).
    const ADMIN_REPLY_KEYBOARD: TelegramBot.ReplyKeyboardMarkup = {
      keyboard: [
        [{ text: '🏠 Bosh panel' }],
        [{ text: '🏷 Atmetka' }, { text: '🔖 Heshteg' }],
        [{ text: '💰 Komissiya' }, { text: '🔍 Qidirish' }],
        [{ text: '📊 Statistika' }, { text: '☑️ Verify' }],
        [{ text: '💳 Balans' }],
        [{ text: '📨 Xabar yuborish' }, { text: '📤 Media yuklash' }],
      ],
      resize_keyboard: true,
      is_persistent: true,
    };

    async function sendAdminDashboard(chatId: number): Promise<void> {
      const daily = getDailyStats();
      const weekly = getWeeklyStats();
      const all = getAllTimeStats();

      const adminKeyboard: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            // 2026-10-01: CS GO / CS GO+Atmetka tizimi ICHKI SINOVDAN O'TIB
            // productionga ko'chirildi — endi "Atmetka qilish" tugmasi
            // orqali BARCHA foydalanuvchilarga ochiq, shu sabab alohida
            // sinov-tugmasi endi kerak emas (o'chirildi).
            ...(WEBAPP_URL ? [[{ text: '🔖 WebApp ochish', web_app: { url: WEBAPP_URL_V } }]] : []),
            [
              { text: '📊 Bugun', callback_data: 'stats' },
              { text: '📈 7 kun', callback_data: 'weekly' },
              { text: '🗂 Umumiy', callback_data: 'all_time' },
            ],
            [
              { text: '⏰ Soatlik', callback_data: 'hourly' },
              { text: '🔥 Pik soat', callback_data: 'peak' },
            ],
            [
              { text: '🎬 Video Analiz', callback_data: 'video_stats' },
            ],
            [
              { text: '🏪 Marketplace statistika', callback_data: 'mkt_stats_hub' },
            ],
            [
              { text: '🔖 Heshteg boshqaruv', callback_data: 'heshteg_back' },
              { text: '📋 So\'rovnoma', callback_data: 'survey_stats' },
            ],
            [
              { text: '🔄 Yangilash', callback_data: 'refresh' },
            ],
          ],
        },
      };

      const welcomeMessage =
`🤖 *ADMIN PANEL*
━━━━━━━━━━━━━━━━━━

📊 *Tezkor ko'rinish*
• Bugun:        *${fmtNum(daily.totalExtractions)}* ta
• So'nggi 7 kun: *${fmtNum(weekly.totalExtractions)}* ta
• Jami:         *${fmtTotal(all.totalExtractions, all.approximate)}* ta

👇 Boshqaruv uchun pastdagi menyu tugmalaridan foydalaning.

_🕐 ${nowTs()}_`;

      await bot?.sendMessage(chatId, welcomeMessage, adminKeyboard);
    }

    // Start command — admin va oddiy userlar uchun farqli
    bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const rawParam = match && match[1] ? match[1].trim() : '';
      if (rawParam) {
        const aucMatch = rawParam.match(/^(?:auction|auc)[_-]?(\d+)?/i);
        if (aucMatch) {
          const aucId = aucMatch[1] || '';
          const targetUrl = aucId
            ? `${WEBAPP_URL}/marketplace?startapp=auction_${aucId}`
            : `${WEBAPP_URL}/marketplace?startapp=auction`;
          await bot
            ?.sendMessage(
              chatId,
              `✨ <b>Collab Auksioni!</b>\n\nAkkaunt auksionida ishtirok etish yoki stavka qo'yish uchun pastdagi tugmani bosing:`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🔥 Auksionni ochish', web_app: { url: targetUrl } }],
                    [{ text: '📱 Bosh sahifa', web_app: { url: WEBAPP_URL_V } }],
                  ],
                },
              },
            )
            .catch(() => {});
          return;
        }
      }

      if (isAdmin(chatId)) {
        await sendAdminDashboard(chatId);
        // Pastki menyu tugmalari alohida xabarda — reply-keyboard va
        // inline-keyboard bitta xabarda birga bo'lolmaydi (Telegram cheklovi).
        await bot?.sendMessage(chatId, '👇 Boshqaruv menyusi', { reply_markup: ADMIN_REPLY_KEYBOARD }).catch(() => {});
      } else {
        // Oddiy user: so'rovnoma yoki WebApp
        try {
          const user = await User.findOne({ telegramId: chatId });

          // Tez yo'l: so'rovnoma allaqachon tugatilgan
          if (user?.surveyCompleted) {
            if (!WEBAPP_URL) {
              bot?.sendMessage(chatId, '⚠️ Dastur hozircha mavjud emas. Keyinroq qayta urinib ko\'ring.');
              return;
            }
            bot?.sendMessage(chatId, `
👋 *Xush kelibsiz!*

Instagram Reel captionlarini olish uchun quyidagi tugmani bosing:
            `, {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '🔖 Heshteg yuklash', web_app: { url: WEBAPP_URL_V } }]
                ]
              }
            });
            return;
          }

          // So'rovnoma holatini tekshirish
          const answeredCount = await SurveyResponse.countDocuments({ telegramId: chatId });

          if (answeredCount === 0) {
            await sendSurveyPoll(chatId, 0);
          } else if (answeredCount === 1) {
            await sendSurveyPoll(chatId, 1);
          } else {
            // Ikkalasi ham javob berilgan, lekin flag qo'yilmagan
            await User.updateOne({ telegramId: chatId }, { $set: { surveyCompleted: true } });
            await sendWebAppButton(chatId);
          }
        } catch (error) {
          console.error('Error in /start handler:', error);
          bot?.sendMessage(chatId, '⚠️ Xatolik yuz berdi. Qayta urinib ko\'ring.');
        }
      }
    });

    // "🏠 Bosh panel" — pastki menyudan bosh panelni qayta ochish
    bot.on('message', async (msg) => {
      if (msg.text !== '🏠 Bosh panel') return;
      const chatId = msg.chat.id;
      if (!isAdmin(chatId)) return;
      await sendAdminDashboard(chatId);
    });

    // Poll javob handler
    bot.on('poll_answer', async (pollAnswer: TelegramBot.PollAnswer) => {
      const pollId = pollAnswer.poll_id;
      const userId = pollAnswer.user.id;
      const selectedOptionIds = pollAnswer.option_ids;

      const pollContext = activePollMap.get(pollId);
      if (!pollContext) {
        return;
      }

      if (pollContext.telegramId !== userId) {
        return;
      }

      // Javob qaytarilgan (retracted)
      if (selectedOptionIds.length === 0) {
        return;
      }

      const selectedOption = selectedOptionIds[0];
      const selectedOptionText = pollContext.options[selectedOption] || 'Noma\'lum';

      try {
        // MongoDB ga saqlash (upsert)
        await SurveyResponse.findOneAndUpdate(
          { telegramId: userId, pollIndex: pollContext.pollIndex },
          {
            $set: {
              firstName: pollAnswer.user.first_name || '',
              question: pollContext.question,
              selectedOption,
              selectedOptionText,
              pollId,
              answeredAt: new Date(),
            },
          },
          { upsert: true, new: true }
        );

        activePollMap.delete(pollId);

        if (pollContext.pollIndex === 0) {
          // 1-savol javob berildi → 2-savolni yuborish
          await sendSurveyPoll(pollContext.chatId, 1);
        } else if (pollContext.pollIndex === 1) {
          // 2-savol javob berildi → so'rovnoma tugadi
          await User.updateOne(
            { telegramId: userId },
            { $set: { surveyCompleted: true } }
          );
          await sendWebAppButton(pollContext.chatId);
        }
      } catch (error) {
        console.error('Error saving survey response:', error);
      }
    });

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat.id;
      const messageId = query.message?.message_id;

      if (!chatId || !isAdmin(chatId)) {
        bot?.answerCallbackQuery(query.id, { text: '❌ Ruxsat yo\'q' });
        return;
      }

      const action = query.data;

      try {
        // Video analiz kunlik limitini o'rnatish (vlimit_0 = cheksiz)
        if (action?.startsWith('vlimit_')) {
          const n = parseInt(action.slice(7), 10);
          if (Number.isFinite(n) && n >= 0 && n <= 100) {
            setVideoLimit(n);
          }
          await handleVideoLimit(chatId, messageId);
          bot?.answerCallbackQuery(query.id, { text: '✅ Limit yangilandi' });
          return;
        }

        switch (action) {
          case 'stats':
            await handleStats(chatId, messageId);
            break;
          case 'weekly':
            await handleWeekly(chatId, messageId);
            break;
          case 'all_time':
            await handleAllTime(chatId, messageId);
            break;
          case 'hourly':
            await handleHourly(chatId, messageId);
            break;
          case 'peak':
            await handlePeak(chatId, messageId);
            break;
          case 'video_stats':
            await handleVideoStats(chatId, messageId);
            break;
          case 'video_hourly':
            await handleVideoHourly(chatId, messageId);
            break;
          case 'video_limit':
            await handleVideoLimit(chatId, messageId);
            break;
          case 'refresh':
            await handleRefresh(chatId, messageId);
            break;
          case 'mkt_stats_hub':
            await handleMarketplaceStatsHub(chatId, messageId);
            break;
          case 'mkt_stats_bio':
            await handleMarketplaceStatsBio(chatId, messageId);
            break;
          case 'mkt_bio_hd_on':
          case 'mkt_bio_hd_off': {
            // Bio rasm sifatini almashtiramiz va qo'shimcha/tejalgan xarajatni
            // HAQIQIY o'rtacha yuklashlar bo'yicha aniq raqamlarda ko'rsatamiz.
            const { setBioHdEnabled, estimateBioCosts, formatBioCostMessage } = await import('./lib/bio-quality');
            const enable = action === 'mkt_bio_hd_on';
            await setBioHdEnabled(enable);
            await bot?.answerCallbackQuery(query.id, { text: enable ? '🖼 Sifatli rasm yoqildi' : '🖼 Oddiy rasm yoqildi' }).catch(() => {});
            const est = await estimateBioCosts();
            await bot?.sendMessage(chatId, formatBioCostMessage(enable, est), { parse_mode: 'HTML' }).catch(() => {});
            await handleMarketplaceStatsBio(chatId, messageId);
            return;
          }
          case 'mkt_stats_orders':
            await handleMarketplaceStatsOrders(chatId, messageId);
            break;
          case 'mkt_stats_applications':
            await handleMarketplaceStatsApplications(chatId, messageId);
            break;
          case 'survey_stats':
            await handleSurveyStats(chatId, messageId);
            break;
          case 'survey_responses':
            await handleSurveyResponses(chatId, messageId);
            break;
          case 'survey_back':
            await handleRefresh(chatId, messageId);
            break;
          case 'heshteg_on':
          case 'heshteg_off': {
            const { setHeshtegEnabled } = await import('./lib/marketplace-config');
            const newState = action === 'heshteg_on';
            await setHeshtegEnabled(newState);
            const statusText = newState ? '🟢 Yoqilgan' : '🔴 O\'chirilgan';
            const text =
              `🔖 *Heshteg olish xizmati*\n\n` +
              `Hozirgi holati: *${statusText}*\n\n` +
              (newState
                ? '_Foydalanuvchilar WebApp orqali Instagram caption va heshteg olishlari mumkin._'
                : '_Xizmat o\'chirilgan. Foydalanuvchilarga "Xizmat vaqtincha yopiq" xabari ko\'rsatiladi._');
            const kb = {
              inline_keyboard: [
                [
                  { text: '🟢 Yoqish', callback_data: 'heshteg_on' },
                  { text: '🔴 O\'chirish', callback_data: 'heshteg_off' },
                ],
                [{ text: '📊 Heshteg statistikasi', callback_data: 'heshteg_stats' }],
              [{ text: '📝 Haftalik xeshteg', callback_data: 'heshteg_weekly' }],
              [{ text: '📢 Hamma xeshteglar kanali', callback_data: 'heshteg_channel' }],
              ],
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: kb,
              }).catch(() => {});
            }
            break;
          }
          case 'heshteg_stats': {
            const daily = getDailyStats();
            const weekly = getWeeklyStats();
            const all = getAllTimeStats();
            const { isHeshtegEnabled } = await import('./lib/marketplace-config');
            const enabled = await isHeshtegEnabled();
            const startDate = new Date(all.firstEventAt).toLocaleString('uz-UZ', {
              day: '2-digit', month: '2-digit', year: 'numeric'
            });
            const text =
              `📊 *Heshteg yuklash statistikasi*\n\n` +
              `Xizmat holati: ${enabled ? '🟢 Yoqilgan' : '🔴 O\'chirilgan'}\n\n` +
              `🗂 *Umumiy (${startDate} dan beri):*\n` +
              `• Caption olishlar: *${all.totalExtractions}*\n` +
              `• Tashriflar: *${all.totalVisits}*\n\n` +
              `📅 *Bugun:*\n` +
              `• Caption olishlar: *${daily.totalExtractions}*\n` +
              `• Tashriflar: *${daily.totalVisits}*\n\n` +
              `📈 *So'nggi 7 kun:*\n` +
              `• Caption olishlar: *${weekly.totalExtractions}*\n` +
              `• Tashriflar: *${weekly.totalVisits}*\n\n` +
              `_Yangilash: ${new Date().toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}_`;
            const kb = {
              inline_keyboard: [
                [{ text: '🔄 Yangilash', callback_data: 'heshteg_stats' }],
                [{ text: '⬅️ Orqaga', callback_data: 'heshteg_back' }],
              ],
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: kb,
              }).catch(() => {});
            }
            break;
          }
          case 'heshteg_weekly': {
            // Hozirgi haftalik xeshtegni ko'rsatish + o'zgartirish ko'rsatmasi
            const fs = await import('fs');
            const path = await import('path');
            const storePath = path.join(process.cwd(), 'server', 'data', 'weekly-hashtag.json');
            let current = '— (sozlanmagan, default ishlatilmoqda)';
            let updatedAt = '—';
            try {
              const raw = fs.readFileSync(storePath, 'utf8');
              const j = JSON.parse(raw);
              if (j.hashtag) current = j.hashtag;
              if (j.updatedAt) updatedAt = String(j.updatedAt).slice(0, 16).replace('T', ' ');
            } catch {}
            const preview = current.length > 600 ? current.slice(0, 600) + '…' : current;
            const text =
              `📝 *Haftalik xeshteg*\n\n` +
              `*Hozirgi:*\n\`${preview.replace(/`/g, '')}\`\n\n` +
              `*Yangilangan:* \`${updatedAt}\``;
            const kb = {
              inline_keyboard: [
                [{ text: "✏️ Yangilash", callback_data: 'heshteg_weekly_edit' }],
                [{ text: '⬅️ Orqaga', callback_data: 'heshteg_back' }],
              ],
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: kb,
              }).catch(() => {});
            }
            break;
          }
          case 'heshteg_back': {
            const { isHeshtegEnabled } = await import('./lib/marketplace-config');
            const enabled = await isHeshtegEnabled();
            const statusText = enabled ? '🟢 Yoqilgan' : '🔴 O\'chirilgan';
            const text =
              `🔖 *Heshteg olish xizmati*\n\n` +
              `Hozirgi holati: *${statusText}*\n\n` +
              `Boshqarish uchun pastdagi tugmalardan foydalaning.`;
            const kb = {
              inline_keyboard: [
                [
                  { text: '🟢 Yoqish', callback_data: 'heshteg_on' },
                  { text: '🔴 O\'chirish', callback_data: 'heshteg_off' },
                ],
                [{ text: '📊 Heshteg statistikasi', callback_data: 'heshteg_stats' }],
              [{ text: '📝 Haftalik xeshteg', callback_data: 'heshteg_weekly' }],
              [{ text: '📢 Hamma xeshteglar kanali', callback_data: 'heshteg_channel' }],
              ],
            };
            if (messageId) {
              await bot?.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: kb,
              }).catch(() => {});
            }
            break;
          }
        }

        bot?.answerCallbackQuery(query.id, { text: '✅ Yangilandi' });
      } catch (error) {
        console.error('Error handling callback:', error);
        bot?.answerCallbackQuery(query.id, { text: '❌ Xatolik yuz berdi' });
      }
    });

    // /foiz, /heshteg, /atmetka — endi hammasi bot-marketplace.ts'da persistent
    // reply-tugmalar (💰 Komissiya, 🔖 Heshteg, 🏷 Atmetka) + inline-step tizimi
    // orqali ishlaydi (initMarketplaceBot ichida). Bu yerdagi eski matn-
    // komanda versiyalari butunlay olib tashlandi.

    bot.onText(/\/help/, (msg) => {
      const chatId = msg.chat.id;

      if (isAdmin(chatId)) {
        const helpMessage = `
📚 *Yordam*

*Komandalar:*
/start - Asosiy menyu
/help - Bu yordam xabari

*Tugmalar:*
🔖 Heshteg yuklash - WebApp ni ochish
📊 Kunlik Statistika - Bugungi ma'lumotlar
📈 Haftalik - So'nggi 7 kun
⏰ Soatlik Taqsimot - Soat bo'yicha taqsimot
🔥 Eng Faol Soat - Eng ko'p foydalanilgan vaqt
📋 So'rovnoma - So'rovnoma statistikasi
🔄 Yangilash - Ma'lumotlarni yangilash
        `;

        bot?.sendMessage(chatId, helpMessage, {
          parse_mode: 'Markdown',
          ...mainKeyboard
        });
      } else {
        bot?.sendMessage(chatId, `
📚 *Yordam*

/start - 🔖 Heshteg yuklash tugmasini ko'rish
/help - Bu yordam xabari

🔖 Heshteg yuklash tugmasini bosib, Instagram caption olish dasturidan foydalaning.
        `, { parse_mode: 'Markdown' });
      }
    });

  } catch (error) {
    console.error('❌ Error starting Telegram bot:', error);
  }
}

// Raqamlarni chiroyli formatlash: 12345 → "12 345"
function fmtNum(n: number): string {
  return new Intl.NumberFormat('uz-UZ').format(n);
}
// Umumiy raqam ko'rsatish (approximate bo'lsa "+" qo'shamiz)
function fmtTotal(n: number, approx?: boolean): string {
  return approx ? `${fmtNum(n)}+` : fmtNum(n);
}
function nowTs(): string {
  return new Date().toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}
async function sendOrEdit(chatId: number, messageId: number | undefined, text: string) {
  if (messageId) {
    await bot?.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...mainKeyboard,
    }).catch(async (e: any) => {
      // "message is not modified" — sukut bilan
      const m = String(e?.message || '');
      if (!/not modified/i.test(m)) {
        await bot?.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard }).catch(() => {});
      }
    });
  } else {
    await bot?.sendMessage(chatId, text, { parse_mode: 'Markdown', ...mainKeyboard }).catch(() => {});
  }
}

async function handleStats(chatId: number, messageId?: number) {
  const stats = getDailyStats();
  const weekly = getWeeklyStats();
  const all = getAllTimeStats();
  const startDate = new Date(all.firstEventAt).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const avgPerDay = all.totalExtractions > 0 && all.firstEventAt
    ? Math.round(all.totalExtractions / Math.max(1, Math.ceil((Date.now() - all.firstEventAt) / 86_400_000)))
    : 0;

  const message =
`📊 *BUGUNGI STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtNum(stats.totalExtractions)}*
👥 Tashriflar:        *${fmtNum(stats.totalVisits)}*

📈 *Solishtirish*
• So'nggi 7 kun:      ${fmtNum(weekly.totalExtractions)}
• Kuniga o'rtacha:    ${fmtNum(avgPerDay)}
• Jami (${startDate} dan): *${fmtTotal(all.totalExtractions, all.approximate)}*

_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handleWeekly(chatId: number, messageId?: number) {
  const weekly = getWeeklyStats();
  const daily = getDailyStats();
  const all = getAllTimeStats();
  const dailyAvg = Math.round(weekly.totalExtractions / 7);
  const todayShare = weekly.totalExtractions > 0
    ? Math.round((daily.totalExtractions / weekly.totalExtractions) * 100)
    : 0;

  const message =
`📈 *7 KUNLIK STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtNum(weekly.totalExtractions)}*
👥 Tashriflar:        *${fmtNum(weekly.totalVisits)}*

📊 *Tahlil*
• Kuniga o'rtacha:    ${fmtNum(dailyAvg)}
• Bugun ulushi:       ${todayShare}%
• Bugun:              ${fmtNum(daily.totalExtractions)}
• Jami:               *${fmtTotal(all.totalExtractions, all.approximate)}*

_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handleAllTime(chatId: number, messageId?: number) {
  const all = getAllTimeStats();
  const daily = getDailyStats();
  const weekly = getWeeklyStats();
  const daysActive = Math.max(1, Math.ceil((Date.now() - all.firstEventAt) / 86_400_000));
  const avgPerDay = Math.round(all.totalExtractions / daysActive);
  const startDate = new Date(all.firstEventAt).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });

  const message =
`🗂 *UMUMIY STATISTIKA*
━━━━━━━━━━━━━━━━━━

🪄 Caption olishlar:  *${fmtTotal(all.totalExtractions, all.approximate)}*
👥 Tashriflar:        *${fmtNum(all.totalVisits)}*

📅 *Davr*
• Ishga tushgan:      ${startDate}
• Faol kunlar:        ${fmtNum(daysActive)} kun
• Kuniga o'rtacha:    ${fmtNum(avgPerDay)}

📊 *Hozirgi davr*
• Bugun:              ${fmtNum(daily.totalExtractions)}
• So'nggi 7 kun:      ${fmtNum(weekly.totalExtractions)}

_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handleHourly(chatId: number, messageId?: number) {
  const hourlyData = getHourlyDistribution();
  const entries = Object.entries(hourlyData).map(([h, c]) => [Number(h), c] as [number, number]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  const maxCount = Math.max(1, ...entries.map(([, c]) => c));

  let message =
`⏰ *SOATLIK TAQSIMOT (Bugun)*
━━━━━━━━━━━━━━━━━━

`;
  if (total === 0) {
    message += `_Bugun hali hech kim foydalanmagan._\n`;
  } else {
    const BAR_LEN = 12;
    for (const [h, c] of entries) {
      if (c === 0) continue;
      const filled = Math.round((c / maxCount) * BAR_LEN);
      const bar = '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
      const hh = String(h).padStart(2, '0');
      message += `\`${hh}:00\` ${bar} ${fmtNum(c)}\n`;
    }
    message += `\n📊 *Jami:* ${fmtNum(total)} ta`;
  }
  message += `\n\n_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handlePeak(chatId: number, messageId?: number) {
  const peak = getPeakHour();
  const daily = getDailyStats();
  const share = daily.totalExtractions > 0
    ? Math.round((peak.count / daily.totalExtractions) * 100)
    : 0;

  const message =
`🔥 *PIK SOAT (Bugun)*
━━━━━━━━━━━━━━━━━━

⏰ *${String(peak.hour).padStart(2, '0')}:00 – ${String((peak.hour + 1) % 24).padStart(2, '0')}:00*
🪄 Caption olishlar: *${fmtNum(peak.count)}*
📊 Kunlik ulushi:    ${share}%

_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handleVideoStats(chatId: number, messageId?: number) {
  const v = getVideoStats();

  const message =
`🎬 *VIDEO ANALIZ STATISTIKASI*
━━━━━━━━━━━━━━━━━━

⚡️ *So'nggi 1 soat:* ${fmtNum(v.lastHour)} ta

📊 *Bugun*
• Tahlillar:      *${fmtNum(v.today)}* ta
• Foydalanuvchi:  ${fmtNum(v.todayUsers)} ta
• O'rtacha viral: ${v.avgViralToday}%

📈 *So'nggi 7 kun*
• Tahlillar:      *${fmtNum(v.week)}* ta
• Foydalanuvchi:  ${fmtNum(v.weekUsers)} ta

🗓 *So'nggi 30 kun*
• Tahlillar:      *${fmtNum(v.month)}* ta
• Foydalanuvchi:  ${fmtNum(v.monthUsers)} ta

🗂 *Umumiy*
• Tahlillar:      *${fmtNum(v.total)}* ta
• Foydalanuvchi:  ${fmtNum(v.totalUsers)} ta
• O'rtacha viral: ${v.avgViralAll}%

_🕐 ${nowTs()}_`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⏰ Soatlik taqsimot', callback_data: 'video_hourly' },
          { text: '🔄 Yangilash', callback_data: 'video_stats' },
        ],
        [
          { text: '⚙️ Kunlik limit', callback_data: 'video_limit' },
        ],
        [
          { text: '⬅️ Orqaga', callback_data: 'refresh' },
        ],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...kb,
    }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

// ─────────────── Marketplace statistika hub — Bio / Video ulash / Arizalar ───────────────
async function handleMarketplaceStatsHub(chatId: number, messageId?: number) {
  const message =
`🏪 *MARKETPLACE STATISTIKA*
━━━━━━━━━━━━━━━━━━

Qaysi bo'lim bo'yicha statistikani ko'rmoqchisiz?

_🕐 ${nowTs()}_`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🪪 Bio yuklash', callback_data: 'mkt_stats_bio' }],
        [{ text: '🎬 Video ulashlar', callback_data: 'mkt_stats_orders' }],
        [{ text: '📝 Yangi arizalar', callback_data: 'mkt_stats_applications' }],
        [{ text: '⬅️ Orqaga', callback_data: 'refresh' }],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...kb }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

async function handleMarketplaceStatsBio(chatId: number, messageId?: number) {
  const b = getBioStats();
  const { isBioHdEnabled, estimateBioCosts } = await import('./lib/bio-quality');
  const hdOn = await isBioHdEnabled();
  // Apify hisobi sekin bo'lsa panel kutib qolmasin — 6 s dan keyin hisobsiz ko'rsatamiz.
  const est = await Promise.race([estimateBioCosts(), new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const qualityBlock =
    `🖼 <b>Rasm sifati:</b> ${hdOn ? '🟢 Sifatli (1080×1080)' : '⚪ Oddiy (320×320)'}\n` +
    (est
      ? hdOn
        ? `💸 Sifatli rasm hozir qo'shmoqda: <b>+${usd(est.hdExtraPerMonthUsd)}/oy</b> (kuniga ~${Math.round(est.runsPerDay)} ta pullik yuklash)\n\n`
        : `💸 Sifatliga o'tilsa: <b>+${usd(est.hdExtraPerMonthUsd)}/oy</b> (kuniga ~${Math.round(est.runsPerDay)} ta pullik yuklash)\n\n`
      : '\n');

  // HTML: avvalgi Markdown matnida kursiv ichida `kod` bor edi — Telegram
  // "can't parse entities" deb rad etar, xato yutilib, admin hech narsa
  // ko'rmasdi (2026-10-12).
  const message =
    `🪪 <b>BIO YUKLASH STATISTIKASI</b>\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `📊 <b>Bugun</b>\n` +
    `• Yuklashlar: <b>${fmtNum(b.today)}</b> ta\n` +
    `• Foydalanuvchi: ${fmtNum(b.todayUsers)} ta\n\n` +
    `📈 <b>So'nggi 7 kun</b>\n` +
    `• Yuklashlar: <b>${fmtNum(b.week)}</b> ta\n` +
    `• Foydalanuvchi: ${fmtNum(b.weekUsers)} ta\n\n` +
    `🗂 <b>Jami (xizmat boshlanganidan beri)</b>\n` +
    `• Yuklashlar: <b>${fmtNum(b.allTime)}</b> ta\n\n` +
    qualityBlock +
    `<i>Manba: WebApp "Bio yuklash" tugmasi + bot.php /bio_olish komandasi birgalikda.</i>\n\n` +
    `<i>🕐 ${nowTs()}</i>`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [hdOn
          ? { text: "⚪ Oddiy rasmga o'tish (arzonroq)", callback_data: 'mkt_bio_hd_off' }
          : { text: "🟢 Sifatli rasmga o'tish", callback_data: 'mkt_bio_hd_on' }],
        [{ text: '🔄 Yangilash', callback_data: 'mkt_stats_bio' }],
        [{ text: '⬅️ Orqaga', callback_data: 'mkt_stats_hub' }],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...kb })
      .catch((e) => console.warn('bio stats edit failed:', e instanceof Error ? e.message : e));
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'HTML', ...kb });
  }
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  AWAITING_SELLER_CONSENT: '⏳ Sotuvchi javobini kutmoqda',
  AWAITING_PAYMENT: '💳 To\'lov kutilmoqda',
  AWAITING_PAYMENT_APPROVAL: '🔍 Admin tasdiqlashini kutmoqda',
  AWAITING_BUYER_MATERIAL: '🎬 Xaridor video yuborishi kutilmoqda',
  PAYMENT_APPROVED: '📤 Sotuvchi post joylashi kutilmoqda',
  AWAITING_BUYER_VERIFY: '✅ Xaridor tasdiqlashi kutilmoqda',
  BUYER_VERIFIED: '🕐 Pul chiqishi kutilmoqda (24s)',
  COMPLETED: '✅ Yakunlangan',
  CANCELLED: '❌ Bekor qilingan',
  DISPUTED: '⚠️ Nizoli',
  REFUNDED: '↩️ Qaytarilgan',
  EXPIRED: '⏰ Muddati o\'tgan',
  PENDING_PAYMENT: '💳 To\'lov kutilmoqda (eski)',
  PAID: '💰 To\'langan (eski)',
  ACCEPTED: '✅ Qabul qilingan (eski)',
  POSTED: '📤 Joylangan (eski)',
};

async function handleMarketplaceStatsOrders(chatId: number, messageId?: number) {
  const { getOrderStats } = await import('./lib/marketplace-stats');
  const o = await getOrderStats();

  const statusLines = Object.entries(o.byStatus)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([status, count]) => `• ${ORDER_STATUS_LABEL[status] || status}: *${fmtNum(count)}*`)
    .join('\n') || '_Hozircha buyurtma yo\'q._';

  const message =
`🎬 *VIDEO ULASHLAR STATISTIKASI*
━━━━━━━━━━━━━━━━━━

📊 *Bugun*
• Yangi buyurtma:  *${fmtNum(o.createdToday)}* ta
• Yakunlangan:     *${fmtNum(o.completedToday)}* ta
• Noyob xaridor:   ${fmtNum(o.uniqueBuyersToday)} ta

📈 *So'nggi 7 kun*
• Yangi buyurtma:  *${fmtNum(o.createdWeek)}* ta
• Yakunlangan:     *${fmtNum(o.completedWeek)}* ta

🗂 *Jami*
• Yangi buyurtma:  *${fmtNum(o.createdAll)}* ta
• Yakunlangan:     *${fmtNum(o.completedAll)}* ta
• Noyob xaridor:   ${fmtNum(o.uniqueBuyersAll)} ta

🧩 *Hozirgi bosqichlar bo'yicha (barcha buyurtmalar)*
${statusLines}

_🕐 ${nowTs()}_`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Yangilash', callback_data: 'mkt_stats_orders' }],
        [{ text: '⬅️ Orqaga', callback_data: 'mkt_stats_hub' }],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...kb }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  PENDING: '⏳ Ko\'rib chiqilmoqda',
  ACTIVE: '✅ Faol (marketplace\'da)',
  SUSPENDED: '🧊 Muzlatilgan',
  BANNED: '⛔️ Bloklangan',
};

async function handleMarketplaceStatsApplications(chatId: number, messageId?: number) {
  const { getAccountApplicationStats } = await import('./lib/marketplace-stats');
  const a = await getAccountApplicationStats();

  const statusLines = Object.entries(a.byStatus)
    .filter(([, count]) => count > 0)
    .sort(([, x], [, y]) => y - x)
    .map(([status, count]) => `• ${ACCOUNT_STATUS_LABEL[status] || status}: *${fmtNum(count)}*`)
    .join('\n') || '_Hozircha ariza yo\'q._';

  const message =
`📝 *YANGI ARIZALAR STATISTIKASI*
━━━━━━━━━━━━━━━━━━

📊 *Bugun kelgan arizalar:* *${fmtNum(a.createdToday)}* ta
📈 *So'nggi 7 kunda:* *${fmtNum(a.createdWeek)}* ta
🗂 *Jami (hammasi vaqtidan beri):* *${fmtNum(a.createdAll)}* ta

🧩 *Hozirgi holat bo'yicha (barcha akkountlar)*
${statusLines}

_🕐 ${nowTs()}_`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Yangilash', callback_data: 'mkt_stats_applications' }],
        [{ text: '⬅️ Orqaga', callback_data: 'mkt_stats_hub' }],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', ...kb }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

async function handleVideoLimit(chatId: number, messageId?: number) {
  const cur = getVideoLimit();
  const curText = cur === 0 ? '♾ Cheksiz' : `${cur} ta/kun`;

  const message =
`⚙️ *VIDEO ANALIZ — KUNLIK LIMIT*
━━━━━━━━━━━━━━━━━━

Oddiy foydalanuvchilar uchun bir kunda ruxsat etilgan tahlillar soni.
_Adminlarga limit ta'sir qilmaydi._

Hozirgi limit: *${curText}*

Yangi limitni tanlang:`;

  const btn = (n: number) => ({
    text: (n === cur ? '✅ ' : '') + (n === 0 ? '♾' : String(n)),
    callback_data: `vlimit_${n}`,
  });

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [btn(1), btn(2), btn(3)],
        [btn(5), btn(10), btn(0)],
        [
          { text: '⬅️ Video statistika', callback_data: 'video_stats' },
        ],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...kb,
    }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

async function handleVideoHourly(chatId: number, messageId?: number) {
  const hourly = getVideoHourlyDistribution();
  const maxCount = Math.max(...Object.values(hourly), 1);

  let bars = '';
  for (let i = 0; i < 24; i++) {
    const count = hourly[i] || 0;
    if (count === 0) continue;
    const barLen = Math.max(1, Math.round((count / maxCount) * 10));
    bars += `${String(i).padStart(2, '0')}:00 ${'▓'.repeat(barLen)} ${count}\n`;
  }
  if (!bars) bars = '_Bugun hali tahlil bo\'lmagan_\n';

  const message =
`🎬 *VIDEO ANALIZ — SOATLIK (Bugun)*
━━━━━━━━━━━━━━━━━━

${bars}
_🕐 ${nowTs()}_`;

  const kb = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⬅️ Video statistika', callback_data: 'video_stats' },
          { text: '🔄 Yangilash', callback_data: 'video_hourly' },
        ],
      ],
    },
  };

  if (messageId) {
    await bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...kb,
    }).catch(() => {});
  } else {
    await bot?.sendMessage(chatId, message, { parse_mode: 'Markdown', ...kb });
  }
}

async function handleRefresh(chatId: number, messageId?: number) {
  // /start menyusiga qaytadi — bosh ekran
  const daily = getDailyStats();
  const weekly = getWeeklyStats();
  const all = getAllTimeStats();
  const message =
`🏠 *ADMIN PANEL*
━━━━━━━━━━━━━━━━━━

📊 *Tezkor ko'rinish*
• Bugun:        *${fmtNum(daily.totalExtractions)}* ta
• So'nggi 7 kun: *${fmtNum(weekly.totalExtractions)}* ta
• Jami:         *${fmtTotal(all.totalExtractions, all.approximate)}* ta

👇 Boshqaruv uchun pastdagi menyu tugmalaridan foydalaning.

_🕐 ${nowTs()}_`;

  await sendOrEdit(chatId, messageId, message);
}

async function handleSurveyStats(chatId: number, messageId?: number) {
  const totalUsers = await User.countDocuments({});
  const totalCompleted = await User.countDocuments({ surveyCompleted: true });

  // 1-savol aggregatsiya
  const poll1Stats = await SurveyResponse.aggregate([
    { $match: { pollIndex: 0 } },
    { $group: { _id: '$selectedOptionText', count: { $sum: 1 } } },
    { $sort: { count: -1 as const } },
  ]);

  // 2-savol aggregatsiya
  const poll2Stats = await SurveyResponse.aggregate([
    { $match: { pollIndex: 1 } },
    { $group: { _id: '$selectedOptionText', count: { $sum: 1 } } },
    { $sort: { count: -1 as const } },
  ]);

  const poll1Total = poll1Stats.reduce((sum: number, s: any) => sum + s.count, 0);
  const poll2Total = poll2Stats.reduce((sum: number, s: any) => sum + s.count, 0);

  let message = `📋 *So'rovnoma Statistikasi*\n\n`;
  message += `👥 Jami foydalanuvchilar: *${totalUsers}*\n`;
  message += `✅ So'rovnomani tugatganlar: *${totalCompleted}*\n`;
  message += `📊 Tugatish foizi: *${totalUsers > 0 ? Math.round((totalCompleted / totalUsers) * 100) : 0}%*\n\n`;

  message += `*1-savol:* ${SURVEY_POLLS[0].question}\n`;
  for (const stat of poll1Stats) {
    const pct = poll1Total > 0 ? Math.round((stat.count / poll1Total) * 100) : 0;
    message += `  • ${stat._id}: *${stat.count}* (${pct}%)\n`;
  }

  message += `\n*2-savol:* ${SURVEY_POLLS[1].question}\n`;
  for (const stat of poll2Stats) {
    const pct = poll2Total > 0 ? Math.round((stat.count / poll2Total) * 100) : 0;
    message += `  • ${stat._id}: *${stat.count}* (${pct}%)\n`;
  }

  if (messageId) {
    bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...surveyKeyboard
    });
  } else {
    bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      ...surveyKeyboard
    });
  }
}

async function handleSurveyResponses(chatId: number, messageId?: number) {
  const recentResponses = await SurveyResponse.aggregate([
    { $sort: { answeredAt: -1 } },
    { $group: {
      _id: '$telegramId',
      answers: { $push: { pollIndex: '$pollIndex', answer: '$selectedOptionText' } },
      name: { $first: '$firstName' },
      completedAt: { $first: '$answeredAt' },
    }},
    { $sort: { completedAt: -1 } },
    { $limit: 15 },
  ]);

  let message = `👥 *So'nggi Javoblar*\n\n`;

  if (recentResponses.length === 0) {
    message += '_Hali javoblar yo\'q_\n';
  } else {
    for (const resp of recentResponses) {
      const answers = resp.answers.sort((a: any, b: any) => a.pollIndex - b.pollIndex);
      message += `👤 *${resp.name || 'Noma\'lum'}* (${resp._id})\n`;
      for (const a of answers) {
        message += `  ${a.pollIndex + 1}) ${a.answer}\n`;
      }
      const date = new Date(resp.completedAt);
      message += `  _${date.toLocaleDateString('uz-UZ')} ${date.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}_\n\n`;
    }
  }

  if (messageId) {
    bot?.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...surveyResponsesKeyboard
    });
  } else {
    bot?.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      ...surveyResponsesKeyboard
    });
  }
}

function isAdmin(chatId: number): boolean {
  return ADMIN_IDS.includes(chatId);
}

// Marketplace + boshqa modullar uchun yordamchi exportlar
export function getBot(): TelegramBot | null {
  return bot;
}
// Foydalanuvchi-tomon bot (Top_sxema_instagrambot) — agar sozlanmagan bo'lsa, asosiy bot.
export function getSellerBot(): TelegramBot | null {
  return sellerBot || bot;
}
export function getAdminIds(): number[] {
  return ADMIN_IDS.filter((n) => !isNaN(n) && n > 0);
}
export async function notifyAdmin(text: string, opts?: any): Promise<void> {
  const ids = getAdminIds();
  if (!bot || ids.length === 0) return;
  await Promise.all(
    ids.map((id) =>
      bot!.sendMessage(id, text, opts).catch((err) =>
        console.warn("notifyAdmin failed:", err instanceof Error ? err.message : err),
      ),
    ),
  );
}

export function stopBot() {
  if (bot) {
    bot.stopPolling();
    console.log('🛑 Telegram bot stopped');
  }
}
