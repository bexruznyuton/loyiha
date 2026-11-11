// Top Sxema V2: Cyber Game Exact Multiplayer Auction UI (4K Edition)
(function() {
  console.log("⚡ Top Sxema V2 Cyber Game Edition initializing...");

  const ADMIN_ID = '8897050018';

  // Saturated Neon Cyber Colors from Game Design
  const WHEEL_COLORS = [
    '#00e5ff', // P1: Bright Cyan / Teal (Alex)
    '#ff7a00', // P2: Vibrant Orange (Chloe)
    '#ff2d87', // P3: Bright Magenta / Pink (Jordan)
    '#8b5cf6', // P4: Electric Purple / Indigo (Mia)
    '#10b981', // P5: Bright Emerald Green (Sam)
    '#d946ef', // P6: Neon Fuchsia / Pink (Liam)
    '#f59e0b', // P7: Amber Gold
    '#3b82f6'  // P8: Sky Blue
  ];

  // SVG Lucide Icons Helpers
  const ICONS = {
    shield: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    trophy: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
    crown: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
    coin: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.8 9A2 2 0 0 0 13 8h-2a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-2a2 2 0 0 1-1.8-1"/><path d="M12 6v2m0 8v2"/></svg>`,
    store: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4"/><path d="M2 7h20"/></svg>`,
    clock: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    send: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    users: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    tag: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>`,
    badge: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76z"/></svg>`,
    plus: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    minus: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    chevron: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
    close: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    gift: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>`,
    externalLink: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
    check: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    spark: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    settings: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    wallet: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>`,
    lightbulb: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
    edit: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`,
    refresh: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`,
    image: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`,
    arrowDownLeft: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17"/><path d="M17 17H7V7"/></svg>`,
    hourglass: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>`,
    alert: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    globe: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>`,
    chart: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="4" width="3" height="14" rx="1"/></svg>`,
    list: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`,
    play: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>`,
    undo: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>`,
    money: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg>`,
    eye: `<svg class="topsxema-svg" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    spinner: `<svg class="topsxema-svg topsxema-spin" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`
  };

  let currentTgUser = null;
  let demoSettings = {
    targetUsername: 'top_sxema_rek67',
    rateStandard500k: 20000,
    rateExtraWord500k: 30000,
    extraWordKeyword: '#topsxema',
    rulesText: '1. Reels yoki Post original bo\'lishi va kamida 24 soat o\'chirilmasligi kerak.\n2. Tizim har kuni videoni avtomatik tarzda tekshiradi.\n3. Har 500 000 prosmotr uchun mablag\' avtomatik hisobingizga tushadi.\n4. Nakrutka yoki soxta ko\'rishlar qat\'iyan man etiladi.',
    dailyBudget: 1000000,
    spentBudget: 0,
    remainingBudget: 1000000
  };

  const _initParams = new URLSearchParams(window.location.search);
  let activeTab = (_initParams.get('tab') === 'auction' || _initParams.get('startapp') === 'auction') ? 'auction' : 'accounts';
  let currentAuction = null;
  let countdownTimer = null;
  let winnerHideTimer = null;
  let wheelAnimFrame = null;
  let wheelRotation = 0;
  let deepLinkHandled = false;
  let lastUrl = window.location.href;

  // Server vaqti bilan sinxronizatsiya (client soat noto'g'ri bo'lsa ham to'g'ri qoladi)
  let serverTimeOffset = 0;

  // Tikish (bid) holati: foydalanuvchi kiritgan summa re-render'da saqlanadi
  let pendingBidAmount = null;
  let bidInFlight = false;

  // Admin panel uchun
  let adminAuctionsCache = [];
  let editingAuctionId = null;
  let editingPrizePhoto = '';

  // Cached Avatar Images
  const avatarImgCache = {};
  function getAvatarImage(url) {
    if (!url) return null;
    if (avatarImgCache[url]) return avatarImgCache[url];
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    avatarImgCache[url] = img;
    return img;
  }

  // Sample HD Avatars — soxta (fake) avatarlar olib tashlandi.
  // O'rniga boshlang'ich harfli neutral avatar ishlatiladi.
  const SAMPLE_AVATARS = [];

  // Initialize Telegram User & Handle Deep Links
  function initTelegram() {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      if (tg.initDataUnsafe?.user) {
        currentTgUser = tg.initDataUnsafe.user;
      }
    }
    if (!currentTgUser) {
      // Telegram WebApp tashqarida (oddiy brauzer) ochilganda:
      // Avvalgi xato — hamma oddiy foydalanuvchi ADMIN bo'lib qolardi.
      // Endi: oddiy "Mehmon" (admin emas). Demo'ni ko'rish uchun
      // ?admin_preview=1 parametri orqali vaqtincha admin rejim ochiladi
      // (server tomoni baribir adminTgId ni tekshiradi).
      const previewAdmin = new URLSearchParams(window.location.search).get('admin_preview') === '1';
      currentTgUser = previewAdmin
        ? { id: 8897050018, first_name: "Admin", username: "admin" }
        : { id: 0, first_name: "Mehmon", username: "guest" };
    }
  }

  function handleDeepLink() {
    if (deepLinkHandled) return;
    const tg = window.Telegram?.WebApp;
    const urlParams = new URLSearchParams(window.location.search);
    const sp = tg?.initDataUnsafe?.start_param ||
               urlParams.get('startapp') ||
               urlParams.get('start') ||
               urlParams.get('tab');

    if (!sp) return;
    deepLinkHandled = true;

    if (sp === 'video_ulash') {
      if (!window.location.pathname.includes('/marketplace')) {
        const mktLink = document.querySelector('a[href*="/marketplace"]');
        if (mktLink) mktLink.click();
        else window.location.href = '/marketplace';
      }
      setTimeout(() => switchMarketplaceTab('accounts'), 200);
    } else if (sp === 'auction') {
      activeTab = 'auction';
      if (!window.location.pathname.includes('/marketplace')) {
        const mktLink = document.querySelector('a[href*="/marketplace"]');
        if (mktLink) mktLink.click();
        else window.location.href = '/marketplace?tab=auction';
      }
      setTimeout(() => switchMarketplaceTab('auction'), 200);
    } else {
      const accMatch = sp.match(/^(?:account_|acc_)?(\d+)$/i);
      if (accMatch && accMatch[1]) {
        const accId = accMatch[1];
        if (!window.location.pathname.includes('/marketplace')) {
          window.location.href = `/marketplace?account=${accId}`;
        }
      }
    }
  }

  function isUserAdmin() {
    if (!currentTgUser) return false;
    return String(currentTgUser.id) === ADMIN_ID;
  }

  // Load Settings
  async function loadSettings() {
    try {
      const res = await fetch('/api/demo/settings');
      const data = await res.json();
      if (data.success) {
        demoSettings = { ...demoSettings, ...data };
        updateBudgetWidget();
      }
    } catch (e) {
      console.warn("loadSettings error:", e);
    }
  }

  // Server vaqtini olib, client soatidan farqni hisoblaydi
  async function syncServerTime() {
    try {
      const res = await fetch('/api/time', { cache: 'no-store' });
      const data = await res.json();
      if (data && data.success && data.serverTime) {
        serverTimeOffset = Number(data.serverTime) - Date.now();
      }
    } catch (e) {
      // Server javob bermasa — client vaqti bilan davom etamiz
    }
  }

  // Escape dynamic values before inserting into innerHTML (XSS protection)
  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Instagram URL'ni xavfsiz qilish (faqat https:// ruxsat etiladi)
  function safeInstagramUrl(auc) {
    const fallback = 'https://instagram.com/' + String(auc.instagram_username || '').replace(/[^A-Za-z0-9._]/g, '');
    const raw = auc.instagram_url || fallback;
    try {
      const u = new URL(raw, window.location.origin);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.href;
    } catch (e) {}
    return fallback;
  }

  // Live budget widget updater (was referenced but never defined -> crash every 500ms)
  function updateBudgetWidget() {
    const daily = Number(demoSettings.dailyBudget || 0);
    const remaining = Number(demoSettings.remainingBudget !== undefined ? demoSettings.remainingBudget : daily);
    const pct = daily > 0 ? Math.min(100, Math.max(0, Math.round((remaining / daily) * 100))) : 0;

    const fill = document.getElementById('topsxema-budget-fill');
    if (fill) fill.style.width = pct + '%';

    const remainingEl = document.getElementById('topsxema-budget-remaining');
    if (remainingEl) remainingEl.textContent = formatMoney(remaining);
  }

  // Toast
  function showToast(msg, isSuccess = true) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: ${isSuccess ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)'};
      color: white;
      padding: 10px 20px;
      border-radius: 20px;
      font-size: 13.5px;
      font-weight: 700;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      z-index: 999999;
      pointer-events: none;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      align-items: center;
      gap: 8px;
    `;
    toast.textContent = (isSuccess ? '✓ ' : '✕ ') + msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

  window.addEventListener('topsxema:toast', (e) => {
    if (e.detail && e.detail.msg) showToast(e.detail.msg);
  });

  // "Atmetka qilish" tugmasini topish (matn ichida bo'lsa ham topiladi)
  function findAtmetkaButton() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
    const matches = candidates.filter(el => {
      const t = (el.innerText || '').trim();
      return t.includes('Atmetka qilish');
    });
    if (!matches.length) return null;
    matches.sort((a, b) => (a.innerText || '').trim().length - (b.innerText || '').trim().length);
    return matches[0];
  }

  // =========================================================================
  // 1. LIVE BUDGET TRACKER (PROFILE & ATMETKA)
  // =========================================================================
  function checkAndInjectLiveBudget() {
    const isProfilePage = window.location.pathname.includes('/profile') ||
                          (!window.location.pathname.includes('/marketplace') &&
                           document.body.innerText.includes('Atmetka qilish'));

    if (!isProfilePage) {
      const existing = document.getElementById('topsxema-live-budget-widget');
      if (existing) existing.remove();
      return;
    }

    const atmetkaBtn = findAtmetkaButton();

    if (document.getElementById('topsxema-live-budget-widget')) {
      updateBudgetWidget();
      placeBudgetWidget(atmetkaBtn);
      syncBudgetWidgetWidth(atmetkaBtn);
      return;
    }

    const budgetCard = document.createElement('div');
    budgetCard.id = 'topsxema-live-budget-widget';
    budgetCard.className = 'topsxema-live-budget-card';

    const daily = Number(demoSettings.dailyBudget || 1000000);
    const remaining = Number(demoSettings.remainingBudget !== undefined ? demoSettings.remainingBudget : daily);
    const pct = Math.min(100, Math.max(0, Math.round((remaining / (daily || 1)) * 100)));

    budgetCard.innerHTML = `
      <div class="topsxema-budget-header">
        <div class="topsxema-budget-title-row">
          <div class="topsxema-budget-pulse-dot"></div>
          <span class="topsxema-budget-title">Jonli Byudjet</span>
        </div>
        <div class="topsxema-budget-live-tag">
          <span>●</span> Real vaqtda
        </div>
      </div>
      <div class="topsxema-budget-progress-track">
        <div class="topsxema-budget-progress-fill" id="topsxema-budget-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="topsxema-budget-numbers-row">
        <span style="color:#94a3b8;">Qolgan mablag':</span>
        <span style="color:#10b981; font-weight:800;" id="topsxema-budget-remaining">${formatMoney(remaining)}</span>
      </div>
      ${isUserAdmin() ? `
        <button id="topsxema-budget-edit-btn" class="topsxema-budget-edit-btn" title="Byudjetni tahrirlash">
          ${ICONS.edit}
          <span>Byudjetni tahrirlash</span>
        </button>
      ` : ''}
    `;

    // Tugma bor bo'lsa — aynan uning ustiga (bir xil kenglikda) joylaymiz
    if (atmetkaBtn && atmetkaBtn.parentElement) {
      atmetkaBtn.parentElement.insertBefore(budgetCard, atmetkaBtn);
      syncBudgetWidgetWidth(atmetkaBtn);
    } else {
      const main = document.querySelector('main') || document.body;
      main.insertBefore(budgetCard, main.firstChild);
    }

    const editBtn = document.getElementById('topsxema-budget-edit-btn');
    if (editBtn) {
      editBtn.onclick = () => {
        adminActivePageTab = 'budget';
        openAdminPage();
      };
    }
  }

  // Vidjet har renderda "Atmetka qilish" tugmasining to'g'risida turishi uchun
  // joyini qayta tekshiramiz (React qayta render qilsa joyi buziladi).
  function placeBudgetWidget(atmetkaBtn) {
    const card = document.getElementById('topsxema-live-budget-widget');
    if (!card) return;
    const btn = atmetkaBtn || findAtmetkaButton();
    if (!btn || !btn.parentElement) return;
    const parent = btn.parentElement;
    if (card.parentElement !== parent || card.nextElementSibling !== btn) {
      parent.insertBefore(card, btn);
    }
  }

  // Byudjet vidjeti "Atmetka qilish" tugmasi bilan bir xil kenglikda bo'lsin
  function syncBudgetWidgetWidth(atmetkaBtn) {
    const card = document.getElementById('topsxema-live-budget-widget');
    if (!card) return;
    const btn = atmetkaBtn || findAtmetkaButton();
    if (!btn) return;
    const w = btn.getBoundingClientRect().width;
    if (w > 20) {
      // CSS'da `width: 100% !important` bor — inline usul ustidan o'tishi uchun
      // ham 'important' bilan yozamiz.
      card.style.setProperty('width', Math.round(w) + 'px', 'important');
      card.style.setProperty('max-width', '100%', 'important');
    }
  }

  function checkAndInjectProfileAdminCard() {
    if (!isUserAdmin()) {
      const existing = document.getElementById('profile-admin-entry-card');
      if (existing) existing.remove();
      return;
    }

    const isProfilePage = window.location.pathname.includes('/profile') ||
                          document.body.innerText.includes('Mening balansim') ||
                          document.body.innerText.includes('Atmetka qilish');

    if (!isProfilePage) {
      const existing = document.getElementById('profile-admin-entry-card');
      if (existing) existing.remove();
      return;
    }

    if (document.getElementById('profile-admin-entry-card')) {
      placeProfileAdminCard();
      return;
    }

    // Jonli byudjet vidjeti "Atmetka qilish" tugmasining to'g'risida turishi kerak,
    // shuning uchun admin kartasi undan YUQORIDA joylashtiriladi.
    const budgetWidget = document.getElementById('topsxema-live-budget-widget');
    const atmetkaBtn = findAtmetkaButton();

    let mountParent = null;
    let refChild = null;

    if (budgetWidget && budgetWidget.parentElement) {
      mountParent = budgetWidget.parentElement;
      refChild = budgetWidget;
    } else if (atmetkaBtn && atmetkaBtn.parentElement) {
      mountParent = atmetkaBtn.parentElement;
      refChild = atmetkaBtn;
    }
    if (!mountParent) mountParent = document.querySelector('main') || document.body;

    const card = document.createElement('div');
    card.id = 'profile-admin-entry-card';
    card.className = 'topsxema-admin-profile-card';
    card.innerHTML = `
      <div class="topsxema-admin-card-inner">
        <div class="topsxema-admin-card-left">
          <div class="topsxema-admin-icon-wrap">
            ${ICONS.shield}
          </div>
          <div class="topsxema-admin-text-wrap">
            <div class="topsxema-admin-card-title-row">
              <span class="topsxema-admin-title">Boshqaruv Paneli</span>
              <span class="topsxema-admin-badge">Admin</span>
            </div>
            <p class="topsxema-admin-subtitle">Auksion, atmetka stavkalari, byudjet va bot xabarnomasi</p>
          </div>
        </div>
        <button id="open-admin-from-profile" class="topsxema-admin-open-btn">
          <span>Ochish</span>
          ${ICONS.chevron}
        </button>
      </div>
    `;

    if (refChild && mountParent) {
      mountParent.insertBefore(card, refChild);
    } else if (mountParent) {
      mountParent.appendChild(card);
    }

    card.onclick = () => openAdminPage();
  }

  // Admin kartasi byudjet vidjetidan YUQORIDA turishi kerak —
  // React qayta render qilsa joyi buzilmasligi uchun har tick'da tekshiramiz.
  function placeProfileAdminCard() {
    const card = document.getElementById('profile-admin-entry-card');
    if (!card) return;
    const budgetWidget = document.getElementById('topsxema-live-budget-widget');
    const atmetkaBtn = findAtmetkaButton();

    let parent = null;
    let ref = null;
    if (budgetWidget && budgetWidget.parentElement) {
      parent = budgetWidget.parentElement;
      ref = budgetWidget;
    } else if (atmetkaBtn && atmetkaBtn.parentElement) {
      parent = atmetkaBtn.parentElement;
      ref = atmetkaBtn;
    }
    if (!parent) return;

    if (card.parentElement !== parent || card.nextElementSibling !== ref) {
      parent.insertBefore(card, ref);
    }
  }

  // =========================================================================
  // 4. CYBER GAME MULTIPLAYER AUCTION UI
  // =========================================================================
  function enhanceMarketplaceWithAuction() {
    const isMarketplace = window.location.pathname.includes('/marketplace') ||
                          document.body.innerText.includes('Akkauntlar do\'koni') ||
                          document.body.innerText.includes('Filtrlar');

    if (!isMarketplace) {
      if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
      const existingTab = document.getElementById('topsxema-tab-container');
      if (existingTab) existingTab.remove();
      const existingArena = document.getElementById('portal-arena-wrapper');
      if (existingArena) existingArena.remove();
      return;
    }

    const main = document.querySelector('main');
    if (!main) return;

    const stickyHeader = main.querySelector('.sticky') || main.firstElementChild;

    // Tab Container
    let tabContainer = document.getElementById('topsxema-tab-container');
    if (!tabContainer || !main.contains(tabContainer)) {
      if (tabContainer) tabContainer.remove();
      tabContainer = document.createElement('div');
      tabContainer.id = 'topsxema-tab-container';
      tabContainer.className = 'topsxema-tab-container';
      tabContainer.innerHTML = `
        <button class="topsxema-tab-btn ${activeTab === 'accounts' ? 'active' : ''}" id="tab-accounts">
          ${ICONS.store} Akkauntlar
        </button>
        <button class="topsxema-tab-btn ${activeTab === 'auction' ? 'active' : ''}" id="tab-auction">
          ${ICONS.trophy} Auksion
        </button>
      `;

      if (stickyHeader && stickyHeader.nextSibling) {
        main.insertBefore(tabContainer, stickyHeader.nextSibling);
      } else {
        main.insertBefore(tabContainer, main.firstChild);
      }

      tabContainer.querySelector('#tab-accounts').onclick = () => switchMarketplaceTab('accounts');
      tabContainer.querySelector('#tab-auction').onclick = () => switchMarketplaceTab('auction');
    } else {
      const btnAcc = tabContainer.querySelector('#tab-accounts');
      const btnAuc = tabContainer.querySelector('#tab-auction');
      if (btnAcc && btnAuc) {
        if (activeTab === 'accounts') {
          btnAcc.classList.add('active');
          btnAuc.classList.remove('active');
        } else {
          btnAuc.classList.add('active');
          btnAcc.classList.remove('active');
        }
      }
    }

    // Arena Container
    let arena = document.getElementById('portal-arena-wrapper');
    if (!arena || !main.contains(arena)) {
      if (arena) arena.remove();
      arena = document.createElement('div');
      arena.id = 'portal-arena-wrapper';
      arena.className = 'portal-arena-wrapper';
      if (tabContainer && tabContainer.nextSibling) {
        main.insertBefore(arena, tabContainer.nextSibling);
      } else {
        main.appendChild(arena);
      }
      loadAuctionData().then(renderAuctionArena);
    }

    // View Visibility
    if (activeTab === 'auction') {
      arena.style.display = 'flex';
      toggleAccountsView(false);
    } else {
      arena.style.display = 'none';
      toggleAccountsView(true);
    }
  }

  function switchMarketplaceTab(tab) {
    activeTab = tab;
    const btnAcc = document.getElementById('tab-accounts');
    const btnAuc = document.getElementById('tab-auction');
    const arena = document.getElementById('portal-arena-wrapper');

    if (tab === 'accounts') {
      if (btnAcc) btnAcc.classList.add('active');
      if (btnAuc) btnAuc.classList.remove('active');
      if (arena) arena.style.display = 'none';
      toggleAccountsView(true);
    } else {
      if (btnAuc) btnAuc.classList.add('active');
      if (btnAcc) btnAcc.classList.remove('active');
      if (arena) arena.style.display = 'flex';
      toggleAccountsView(false);
      window.scrollTo({ top: 0, behavior: 'instant' });
      loadAuctionData().then(renderAuctionArena);
    }
  }

  function toggleAccountsView(show) {
    const main = document.querySelector('main');
    if (!main) return;
    const children = Array.from(main.children);
    children.forEach(c => {
      if (
        c.id === 'topsxema-tab-container' ||
        c.id === 'portal-arena-wrapper' ||
        c.classList.contains('sticky') ||
        c.querySelector('.sticky')
      ) {
        return;
      }
      c.style.display = show ? '' : 'none';
    });
  }

  async function mountAuctionUI() {
    let arena = document.getElementById('portal-arena-wrapper');
    const main = document.querySelector('main');
    const tabContainer = document.getElementById('topsxema-tab-container');

    if (!arena && main) {
      arena = document.createElement('div');
      arena.id = 'portal-arena-wrapper';
      arena.className = 'portal-arena-wrapper';
      if (tabContainer && tabContainer.nextSibling) {
        main.insertBefore(arena, tabContainer.nextSibling);
      } else {
        main.appendChild(arena);
      }
    }
    if (arena) {
      arena.style.display = 'flex';
      toggleAccountsView(false);
    }

    await loadAuctionData();
    renderAuctionArena();
  }

  let animPlayersState = [];
  let lastNewBidTelegramId = null;
  let newBidBurstTime = 0;
  let currentUserBalance = 0;

  async function loadAuctionData() {
    try {
      const res = await fetch('/api/auctions');
      const json = await res.json();
      if (json.success && json.auctions && json.auctions.length > 0) {
        const topAuc = json.auctions[0];
        try {
          const detailRes = await fetch('/api/auctions/' + topAuc.id);
          const detailJson = await detailRes.json();
          if (detailJson.success && detailJson.auction) {
            // ONLY REAL PLAYERS FROM BACKEND (NO FAKE FILLERS!)
            const rawPlayers = detailJson.players || [];
            const totalPot = detailJson.totalPot || rawPlayers.reduce((s, p) => s + Number(p.totalBid || p.amount || 0), 0);

            // Calculate normalized percentages so 100% of the rectangle is filled
            const players = rawPlayers.map((p, idx) => {
              const bidAmt = Number(p.totalBid || p.amount || 0);
              const pct = totalPot > 0 ? parseFloat(((bidAmt / totalPot) * 100).toFixed(1)) : (100 / Math.max(1, rawPlayers.length));
              return {
                user_id: p.userId || p.id || (idx + 1),
                telegram_id: String(p.telegramId),
                user_name: p.userName || 'Ishtirokchi',
                user_avatar: p.userAvatar || p.user_avatar || '',
                total_bid: bidAmt,
                chance_pct: pct
              };
            });

            // Update or initialize smooth animated players state
            const newAnimState = [];
            for (const p of players) {
              const existing = animPlayersState.find(a => a.telegram_id === p.telegram_id);
              if (existing) {
                if (p.total_bid > existing.total_bid) {
                  lastNewBidTelegramId = p.telegram_id;
                  newBidBurstTime = Date.now();
                }
                newAnimState.push({
                  ...p,
                  currentPct: existing.currentPct,
                  targetPct: p.chance_pct
                });
              } else {
                newAnimState.push({
                  ...p,
                  currentPct: 0,
                  targetPct: p.chance_pct
                });
              }
            }
            animPlayersState = newAnimState;

            currentAuction = {
              ...detailJson.auction,
              currency: 'UZS',
              players,
              bids: detailJson.bids || [],
              totalPot: totalPot || detailJson.auction.current_bid || 0
            };

            // Fetch live UZS wallet balance from DB (mehmon uchun so'rovlamaymiz)
            try {
              if (currentTgUser && currentTgUser.id) {
                const bRes = await fetch(`/api/demo/users/${currentTgUser.id}/balance`);
                const bJson = await bRes.json();
                if (bJson.success && bJson.balance !== undefined) {
                  currentUserBalance = Number(bJson.balance);
                  const bEl = document.getElementById('portal-user-balance');
                  if (bEl) bEl.innerText = `Hamyon: ${formatMoney(currentUserBalance)}`;
                }
              }
            } catch (bErr) {}

            return;
          }
        } catch (detailErr) {
          console.warn("detail auction fetch err:", detailErr);
        }
        currentAuction = topAuc;
      } else {
        // Auksion yo'q — eski (stale) ma'lumot qolmasin
        currentAuction = null;
        animPlayersState = [];
      }
    } catch (e) {
      console.warn("loadAuctionData error:", e);
    }
  }

  function formatMoney(amount) {
    const num = Number(amount || 0);
    return num.toLocaleString('uz-UZ') + " UZS";
  }

  // Server bilan sinxronlangan joriy vaqt
  function serverNow() {
    return Date.now() + serverTimeOffset;
  }

  // =========================================================================
  // 5. PRIZE DETAILS SHEET MODAL ("yutuq bosganda barchasi chiqib kelishi kerak")
  // =========================================================================
  function openPrizeModal(auc) {
    let modal = document.getElementById('portals-prize-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'portals-prize-modal';
    modal.className = 'topsxema-modal-backdrop';
    modal.innerHTML = `
      <div class="topsxema-modal-sheet">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="color:#fbbf24;">${ICONS.gift}</div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Auksion Yutug'i Haqida</h3>
          </div>
          <button id="close-prize-modal" style="background:rgba(255,255,255,0.08); border:none; color:#94a3b8; width:30px; height:30px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center;">${ICONS.close}</button>
        </div>

        ${auc.prize_photo ? `
          <div class="portals-prize-photo-wrap">
            <img src="${escapeHtml(auc.prize_photo)}" class="portals-prize-photo" alt="Yutuq rasmi" referrerpolicy="no-referrer" onerror="this.parentElement.style.display='none';">
          </div>
        ` : ''}

        <div class="portals-prize-dialog-avatar">
          <img src="${escapeHtml(auc.instagram_avatar || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">
        </div>

        <div style="text-align:center; margin-bottom:14px;">
          <div style="font-size:17px; font-weight:800; color:#fff;">@${escapeHtml(auc.instagram_username)}</div>
          <div style="display:inline-flex; align-items:center; gap:4px; background:rgba(251,191,36,0.15); border:1px solid rgba(251,191,36,0.4); padding:3px 10px; border-radius:12px; color:#fbbf24; font-size:11.5px; font-weight:700; margin-top:5px;">
            ${ICONS.spark} ${escapeHtml(auc.audience_size || '')}
          </div>
        </div>

        <a href="${escapeHtml(safeInstagramUrl(auc))}" target="_blank" rel="noopener noreferrer" class="portals-prize-open-ig-btn">
          ${ICONS.externalLink} Instagram Profilini Ko'rish
        </a>

        <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:12px; margin-bottom:10px;">
          <div style="font-size:11px; color:#94a3b8; font-weight:700; text-transform:uppercase; margin-bottom:4px;">Yutuq Sloti Tavsifi:</div>
          <div style="font-size:13px; color:#e2e8f0; line-height:1.45;">
            ${escapeHtml(auc.description || auc.title || 'Instagram Reels hammualliflik (Collab) sloti. G\'olibning videosi 24 soat davomida akkauntda pinned holda saqlanadi.')}
          </div>
        </div>

        ${(() => {
          const d = (auc.prize_details && typeof auc.prize_details === 'object') ? auc.prize_details : {};
          const rows = [
            { k: 'Yutuq turi / rate', v: d.category },
            { k: 'Taxminiy qamrov', v: d.reach },
            { k: 'Yutuq muddati', v: d.deadline }
          ].filter(r => r.v);
          if (!rows.length) return '';
          return `
            <div style="background:rgba(14, 165, 233, 0.07); border:1px solid rgba(14, 165, 233, 0.22); border-radius:16px; padding:12px; margin-bottom:10px;">
              <div style="font-size:11px; color:#38bdf8; font-weight:700; text-transform:uppercase; margin-bottom:6px;">Yutuq haqida to'liq ma'lumot:</div>
              ${rows.map(r => `
                <div style="display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:4px;">
                  <span style="color:#94a3b8;">${escapeHtml(r.k)}:</span>
                  <span style="color:#e2e8f0; font-weight:700; text-align:right;">${escapeHtml(r.v)}</span>
                </div>
              `).join('')}
            </div>
          `;
        })()}

        ${auc.note ? `
          <div style="background:rgba(234, 179, 8, 0.08); border:1px solid rgba(234, 179, 8, 0.25); border-radius:16px; padding:12px; margin-bottom:10px;">
            <div style="font-size:11px; color:#fbbf24; font-weight:700; text-transform:uppercase; margin-bottom:4px;">Eslatma va Shartlar:</div>
            <div style="font-size:12.5px; color:#fde68a; line-height:1.45; white-space:pre-line;">
              ${escapeHtml(auc.note)}
            </div>
          </div>
        ` : ''}

        <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.04); border-radius:12px; padding:10px 12px; font-size:12px;">
          <span style="color:#94a3b8;">Auksion Moderatori:</span>
          <span style="color:#38bdf8; font-weight:700;">${escapeHtml(auc.admin_name || 'Admin')} ${auc.admin_username ? '(@' + escapeHtml(auc.admin_username) + ')' : ''}</span>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.querySelector('#close-prize-modal').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  }

  // =========================================================================
  // 5b. USER FEEDBACK MODAL ("feedbeecklar g'oyalar oylab chiqgin")
  // =========================================================================
  function openFeedbackModal() {
    let modal = document.getElementById('topsxema-feedback-modal-root');
    if (modal) modal.remove();

    let selectedCat = 'Taklif';

    modal = document.createElement('div');
    modal.id = 'topsxema-feedback-modal-root';
    modal.className = 'topsxema-modal-backdrop';
    modal.innerHTML = `
      <div class="topsxema-feedback-modal">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:8px;">
            <div style="color:#c084fc;">${ICONS.lightbulb}</div>
            <h3 style="font-size:16px; font-weight:800; color:#fff; margin:0;">Fikr va G'oyalar</h3>
          </div>
          <button id="close-feedback-modal" style="background:rgba(255,255,255,0.08); border:none; color:#94a3b8; width:30px; height:30px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center;">${ICONS.close}</button>
        </div>

        <p style="font-size:12px; color:#94a3b8; margin:8px 0 0;">Platformani yanada qulaylashtirish bo'yicha taklifingiz bormi? Yozib qoldiring!</p>

        <div class="topsxema-cat-selector">
          <div class="topsxema-cat-chip active" data-cat="Taklif">${ICONS.lightbulb} Taklif</div>
          <div class="topsxema-cat-chip" data-cat="Fikr">${ICONS.spark} Fikr</div>
          <div class="topsxema-cat-chip" data-cat="Muammo">${ICONS.alert} Muammo</div>
        </div>

        <textarea id="feedback-input-msg" class="topsxema-feedback-textarea" placeholder="O'z fikr, g'oya yoki taklifingizni bu yerga yozing..."></textarea>

        <button id="btn-submit-user-feedback" class="topsxema-admin-save-btn" style="width:100%;">
          ${ICONS.send} Fikrni Yuborish
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    const chips = modal.querySelectorAll('.topsxema-cat-chip');
    chips.forEach(c => {
      c.onclick = () => {
        chips.forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        selectedCat = c.dataset.cat;
      };
    });

    modal.querySelector('#close-feedback-modal').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelector('#btn-submit-user-feedback').onclick = async () => {
      const msg = document.getElementById('feedback-input-msg')?.value.trim();
      if (!msg) return showToast("Fikr matnini kiriting", false);

      const btn = document.getElementById('btn-submit-user-feedback');
      btn.disabled = true;
      btn.innerHTML = `Yuborilmoqda...`;

      try {
        const res = await fetch('/api/demo/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            telegramId: currentTgUser ? currentTgUser.id : null,
            userName: currentTgUser ? (currentTgUser.first_name + ' ' + (currentTgUser.last_name || '')).trim() : 'Foydalanuvchi',
            category: selectedCat,
            message: msg
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast(data.message || "Rahmat! Fikringiz qabul qilindi.");
          modal.remove();
        } else {
          showToast(data.error || "Xatolik yuz berdi", false);
        }
      } catch (err) {
        showToast("Aloqa xatosi", false);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `${ICONS.send} Fikrni Yuborish`;
      }
    };
  }

  // =========================================================================
  // 6. DEDICATED FULL ADMIN PANEL PAGE ("huddi foydalanuvchi navigation dizaynida")
  // =========================================================================
  // Admin panelga doimiy kirish tugmasi (web app ichida)
  function checkAndInjectAdminFab() {
    if (!isUserAdmin()) {
      const fab = document.getElementById('topsxema-admin-fab');
      if (fab) fab.remove();
      return;
    }
    if (document.getElementById('topsxema-admin-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'topsxema-admin-fab';
    fab.className = 'topsxema-admin-fab';
    fab.title = 'Admin panel';
    fab.setAttribute('aria-label', 'Admin panel');
    fab.innerHTML = ICONS.shield;
    fab.onclick = () => openAdminPage();
    document.body.appendChild(fab);
  }

  let adminActivePageTab = 'auctions';

  function openAdminPage() {
    let page = document.getElementById('topsxema-admin-page-root');
    if (page) page.remove();

    page = document.createElement('div');
    page.id = 'topsxema-admin-page-root';
    page.className = 'topsxema-admin-page-container';

    page.innerHTML = `
      <!-- Top Sticky Header -->
      <div class="topsxema-admin-top-header">
        <div class="topsxema-admin-header-left">
          <div class="topsxema-admin-header-icon">${ICONS.shield}</div>
          <div class="topsxema-admin-top-title">Top Sxema Admin Panel</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="topsxema-admin-live-badge"><span class="topsxema-admin-live-dot"></span> Jonli</span>
          <button id="btn-close-admin-page" class="topsxema-admin-exit-btn">
            Yopish
          </button>
        </div>
      </div>

      <!-- Main Body Container -->
      <div class="topsxema-admin-content" id="admin-page-dynamic-content"></div>

      <!-- Bottom Nav: foydalanuvchi panelidagidek floating glass pill + animatsiyali indikator -->
      <div class="topsxema-admin-bottom-nav">
        <div class="topsxema-admin-nav-pill" id="admin-nav-pill">
          <span class="topsxema-admin-nav-indicator" id="admin-nav-indicator"></span>
          <button class="topsxema-admin-nav-item ${adminActivePageTab === 'auctions' ? 'active' : ''}" data-nav="auctions">
            ${ICONS.trophy}
            <span>Auksion</span>
          </button>
          <button class="topsxema-admin-nav-item ${adminActivePageTab === 'tag' ? 'active' : ''}" data-nav="tag">
            ${ICONS.tag}
            <span>Atmetka</span>
          </button>
          <button class="topsxema-admin-nav-item ${adminActivePageTab === 'budget' ? 'active' : ''}" data-nav="budget">
            ${ICONS.wallet}
            <span>Byudjet</span>
          </button>
          <button class="topsxema-admin-nav-item ${adminActivePageTab === 'feedbacks' ? 'active' : ''}" data-nav="feedbacks">
            ${ICONS.lightbulb}
            <span>Fikrlar</span>
          </button>
        </div>
        <button class="topsxema-admin-nav-round" id="btn-close-admin-page-round" aria-label="Yopish" title="Yopish">
          ${ICONS.close}
        </button>
      </div>
    `;

    document.body.appendChild(page);
    window.scrollTo({ top: 0, behavior: 'instant' });

    const closePage = () => page.remove();
    page.querySelector('#btn-close-admin-page').onclick = closePage;
    const roundClose = page.querySelector('#btn-close-admin-page-round');
    if (roundClose) roundClose.onclick = closePage;

    const navBtns = page.querySelectorAll('.topsxema-admin-nav-item');
    navBtns.forEach(btn => {
      btn.onclick = () => {
        navBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        adminActivePageTab = btn.dataset.nav;
        moveAdminIndicator();
        renderAdminPageContent();
      };
    });

    moveAdminIndicator();
    renderAdminPageContent();
  }

  // Indikatorni faol bo'limga silliq ko'chirish (foydalanuvchi nav'idagidek)
  function moveAdminIndicator() {
    const pill = document.getElementById('admin-nav-pill');
    const ind = document.getElementById('admin-nav-indicator');
    if (!pill || !ind) return;
    const items = pill.querySelectorAll('.topsxema-admin-nav-item');
    if (!items.length) return;
    const active = pill.querySelector('.topsxema-admin-nav-item.active') || items[0];
    const idx = Array.from(items).indexOf(active);
    ind.style.width = `calc((100% - 8px) / ${items.length})`;
    ind.style.translate = `${Math.max(0, idx) * 100}% 0`;
  }

async function renderAdminPageContent() {
    const container = document.getElementById('admin-page-dynamic-content');
    if (!container) return;

    if (adminActivePageTab === 'auctions') {
      await renderAdminAuctionsTab(container);
    } else if (adminActivePageTab === 'tag') {
      renderAdminTagTab(container);
    } else if (adminActivePageTab === 'budget') {
      renderAdminBudgetTab(container);
    } else if (adminActivePageTab === 'feedbacks') {
      await renderAdminFeedbacksTab(container);
    }
  }

  // =========================================================================
  // ADMIN: AUKSIONLAR — yaratish, tahrirlash, ochish, refund
  // =========================================================================
  function adminFieldValue(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function auctionFormPayload() {
    return {
      title: adminFieldValue('adm-auc-title'),
      instagramUsername: adminFieldValue('adm-auc-ig').replace(/^@/, ''),
      audienceSize: adminFieldValue('adm-auc-aud'),
      instagramUrl: adminFieldValue('adm-auc-igurl'),
      instagramAvatar: adminFieldValue('adm-auc-avatar'),
      startingPrice: parseInt(adminFieldValue('adm-auc-price'), 10),
      minStep: parseInt(adminFieldValue('adm-auc-step'), 10),
      durationHours: parseFloat(adminFieldValue('adm-auc-dur')),
      description: adminFieldValue('adm-auc-desc'),
      note: adminFieldValue('adm-auc-note'),
      prizeDetails: {
        category: adminFieldValue('adm-auc-cat'),
        reach: adminFieldValue('adm-auc-reach'),
        deadline: adminFieldValue('adm-auc-deadline')
      }
    };
  }

  function fillAuctionForm(auction) {
    const details = (auction && auction.prize_details && typeof auction.prize_details === 'object') ? auction.prize_details : {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val === undefined || val === null ? '' : val;
    };
    set('adm-auc-title', auction.title);
    set('adm-auc-ig', auction.instagram_username);
    set('adm-auc-aud', auction.audience_size);
    set('adm-auc-igurl', auction.instagram_url);
    set('adm-auc-avatar', auction.instagram_avatar);
    set('adm-auc-price', auction.starting_price);
    set('adm-auc-step', auction.min_step);
    set('adm-auc-dur', auction.duration_hours || 2);
    set('adm-auc-desc', auction.description);
    set('adm-auc-note', auction.note);
    set('adm-auc-cat', details.category);
    set('adm-auc-reach', details.reach);
    set('adm-auc-deadline', details.deadline);
    editingPrizePhoto = auction.prize_photo || '';
    const prev = document.getElementById('adm-auc-photo-preview');
    if (prev) {
      prev.src = editingPrizePhoto || '';
      prev.style.display = editingPrizePhoto ? 'block' : 'none';
    }
  }

  function resetAuctionForm() {
    editingAuctionId = null;
    editingPrizePhoto = '';
    document.querySelectorAll('#topsxema-admin-auction-form input, #topsxema-admin-auction-form textarea, #topsxema-admin-auction-form select').forEach(el => {
      el.value = '';
    });
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('adm-auc-price', '50000');
    set('adm-auc-step', '10000');
    set('adm-auc-dur', '2');
    const prev = document.getElementById('adm-auc-photo-preview');
    if (prev) { prev.src = ''; prev.style.display = 'none'; }
    const file = document.getElementById('adm-auc-photo-file');
    if (file) file.value = '';
    const titleEl = document.getElementById('adm-auc-form-heading');
    if (titleEl) titleEl.innerHTML = `${ICONS.trophy} Yangi Auksion Yaratish`;
    const cancelBtn = document.getElementById('btn-adm-cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';
  }

  async function renderAdminAuctionsTab(container) {
    const editing = editingAuctionId ? adminAuctionsCache.find(a => String(a.id) === String(editingAuctionId)) : null;

    container.innerHTML = `
      <div class="topsxema-admin-card" id="topsxema-admin-auction-form">
        <div class="topsxema-admin-card-header">
          <div class="topsxema-admin-card-title" id="adm-auc-form-heading">
            ${editing ? `${ICONS.edit} Auksionni Tahrirlash (#${editing.id})` : `${ICONS.trophy} Yangi Auksion Yaratish`}
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label class="topsxema-form-label">Auksion Sarlavhasi:</label>
            <input type="text" id="adm-auc-title" class="topsxema-admin-input" placeholder="Masalan: Reels Collab (1M+ qamrov)">
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label class="topsxema-form-label">Instagram Username:</label>
              <input type="text" id="adm-auc-ig" class="topsxema-admin-input" placeholder="masalan: uzb_rek_official">
            </div>
            <div>
              <label class="topsxema-form-label">Obunachilar soni:</label>
              <input type="text" id="adm-auc-aud" class="topsxema-admin-input" placeholder="masalan: 1.2M obunachi">
            </div>
          </div>

          <div>
            <label class="topsxema-form-label">Instagram Profil Havolasi (URL):</label>
            <input type="text" id="adm-auc-igurl" class="topsxema-admin-input" placeholder="https://instagram.com/username">
          </div>

          <div>
            <label class="topsxema-form-label">Instagram Profil Rasmi (Avatar URL):</label>
            <input type="text" id="adm-auc-avatar" class="topsxema-admin-input" placeholder="Rasm URL (ixtiyoriy)">
          </div>

          <div class="topsxema-admin-photo-block">
            <label class="topsxema-form-label">${ICONS.image} Yutuq (Sovg'a) Rasmi:</label>
            <input type="file" id="adm-auc-photo-file" accept="image/png,image/jpeg,image/webp,image/gif" class="topsxema-admin-file-input">
            <input type="text" id="adm-auc-photo-url" class="topsxema-admin-input" placeholder="yoki rasm URL (ixtiyoriy)" style="margin-top:8px;">
            <img id="adm-auc-photo-preview" class="topsxema-admin-photo-preview" alt="" style="display:none;" referrerpolicy="no-referrer">
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label class="topsxema-form-label">Boshlang'ich Narx (UZS):</label>
              <input type="number" id="adm-auc-price" class="topsxema-admin-input" value="50000">
            </div>
            <div>
              <label class="topsxema-form-label">Stavka Qadami (0 = Erkin):</label>
              <input type="number" id="adm-auc-step" class="topsxema-admin-input" value="10000">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label class="topsxema-form-label">Davomiyligi (Soatda):</label>
              <select id="adm-auc-dur" class="topsxema-admin-select">
                <option value="1">1 Soat</option>
                <option value="2" selected>2 Soat</option>
                <option value="6">6 Soat</option>
                <option value="12">12 Soat</option>
                <option value="24">24 Soat (1 Kun)</option>
                <option value="48">48 Soat (2 Kun)</option>
              </select>
            </div>
            <div>
              <label class="topsxema-form-label">Yutuq Turi / Rate:</label>
              <input type="text" id="adm-auc-cat" class="topsxema-admin-input" placeholder="masalan: Reels / 1 soat">
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label class="topsxema-form-label">Taxminiy Qamrov:</label>
              <input type="text" id="adm-auc-reach" class="topsxema-admin-input" placeholder="masalan: 500K+ ko'rish">
            </div>
            <div>
              <label class="topsxema-form-label">Yutuq Muddati:</label>
              <input type="text" id="adm-auc-deadline" class="topsxema-admin-input" placeholder="masalan: 24 soat pinned">
            </div>
          </div>

          <div>
            <label class="topsxema-form-label">Tavsif (Slot haqida ma'lumot):</label>
            <textarea id="adm-auc-desc" class="topsxema-admin-textarea" placeholder="Yutuq haqida to'liq ma'lumot..."></textarea>
          </div>

          <div>
            <label class="topsxema-form-label">Eslatma / Izoh (Ixtiyoriy):</label>
            <textarea id="adm-auc-note" class="topsxema-admin-textarea" placeholder="Qo'shimcha shartlar..."></textarea>
          </div>

          <div style="display:flex; gap:10px;">
            <button id="btn-adm-save-auc" class="topsxema-admin-save-btn" style="flex:1;">
              ${ICONS.check} ${editing ? 'O\'zgarishlarni Saqlash' : 'Auksionni Boshlash va E\'lon Qilish'}
            </button>
            <button id="btn-adm-cancel-edit" class="topsxema-admin-exit-btn" style="display:${editing ? 'flex' : 'none'};">
              Bekor qilish
            </button>
          </div>
        </div>
      </div>

      <div class="topsxema-admin-card">
        <div class="topsxema-admin-card-header">
          <div class="topsxema-admin-card-title">${ICONS.list} Barcha Auksionlar</div>
          <button id="btn-adm-reload-aucs" class="topsxema-admin-icon-btn" title="Yangilash">${ICONS.refresh}</button>
        </div>
        <div id="admin-auctions-list" style="margin-top:12px;">
          <div style="text-align:center; padding:16px; color:#64748b; font-size:13px;">Yuklanmoqda...</div>
        </div>
      </div>
    `;

    if (editing) fillAuctionForm(editing);
    else resetAuctionForm();

    const cancelEdit = container.querySelector('#btn-adm-cancel-edit');
    if (cancelEdit) cancelEdit.onclick = () => { resetAuctionForm(); renderAdminPageContent(); };

    const reloadBtn = container.querySelector('#btn-adm-reload-aucs');
    if (reloadBtn) reloadBtn.onclick = () => loadAdminAuctions();

    // Yutuq rasmi: fayldan yoki URL dan
    const photoFile = container.querySelector('#adm-auc-photo-file');
    if (photoFile) {
      photoFile.onchange = () => {
        const file = photoFile.files && photoFile.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
          showToast('Rasm hajmi 4 MB dan oshmasligi kerak', false);
          photoFile.value = '';
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          editingPrizePhoto = String(reader.result || '');
          const prev = container.querySelector('#adm-auc-photo-preview');
          if (prev) { prev.src = editingPrizePhoto; prev.style.display = 'block'; }
        };
        reader.readAsDataURL(file);
      };
    }

    const saveBtn = container.querySelector('#btn-adm-save-auc');
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const payload = auctionFormPayload();
        if (!payload.title || !payload.instagramUsername) return showToast("Sarlavha va Instagram username majburiy", false);
        if (!Number.isFinite(payload.startingPrice) || payload.startingPrice < 0) return showToast("Boshlang'ich narx noto'g'ri", false);
        if (!Number.isFinite(payload.minStep) || payload.minStep < 0) return showToast("Stavka qadami noto'g'ri", false);
        if (!Number.isFinite(payload.durationHours) || payload.durationHours <= 0) return showToast("Davomiylilik noto'g'ri", false);

        const photoUrl = adminFieldValue('adm-auc-photo-url');
        const photo = editingPrizePhoto || photoUrl || '';

        saveBtn.disabled = true;
        saveBtn.innerHTML = `${ICONS.spinner} Saqlanmoqda...`;

        try {
          const url = editingAuctionId ? `/api/auctions/${editingAuctionId}/update` : '/api/auctions';
          const body = editingAuctionId
            ? { ...payload, adminTgId: currentTgUser.id, prizePhoto: photo }
            : { ...payload, telegramId: currentTgUser.id, prizePhoto: photo };

          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const json = await res.json();
          if (json.success) {
            showToast(editingAuctionId ? "Auksion ma'lumotlari yangilandi!" : "Auksion muvaffaqiyatli yaratildi va boshlandi!");
            editingAuctionId = null;
            editingPrizePhoto = '';
            await loadAuctionData();
            renderAuctionArena();
            await loadAdminAuctions();
            renderAdminPageContent();
          } else {
            showToast(json.error || "Xatolik", false);
          }
        } catch (e) {
          showToast("Aloqa xatosi: " + e.message, false);
        } finally {
          saveBtn.disabled = false;
          saveBtn.innerHTML = `${ICONS.check} Saqlash`;
        }
      };
    }

    await loadAdminAuctions();
  }

  async function loadAdminAuctions() {
    const listEl = document.getElementById('admin-auctions-list');
    if (!listEl) return;
    try {
      const res = await fetch('/api/auctions');
      const json = await res.json();
      if (!json.success || !json.auctions) {
        listEl.innerHTML = `<div style="color:#ef4444; padding:12px; font-size:13px;">Auksionlarni yuklab bo'lmadi.</div>`;
        return;
      }
      adminAuctionsCache = json.auctions;
      renderAdminAuctionsList(listEl);
    } catch (e) {
      listEl.innerHTML = `<div style="color:#ef4444; padding:12px; font-size:13px;">Aloqa xatosi.</div>`;
    }
  }

  function auctionStatusBadge(status) {
    const map = {
      ACTIVE: { txt: 'FAOL', bg: 'rgba(16,185,129,0.16)', color: '#10b981' },
      COMPLETED: { txt: 'YAKUNLANDI', bg: 'rgba(251,191,36,0.16)', color: '#fbbf24' },
      CANCELLED: { txt: 'BEKOR QILINDI', bg: 'rgba(239,68,68,0.16)', color: '#ef4444' }
    };
    const s = map[status] || { txt: status || '-', bg: 'rgba(148,163,184,0.16)', color: '#94a3b8' };
    return `<span class="topsxema-admin-auc-badge" style="background:${s.bg}; color:${s.color};">${s.txt}</span>`;
  }

  function renderAdminAuctionsList(listEl) {
    if (!adminAuctionsCache.length) {
      listEl.innerHTML = `<div style="text-align:center; padding:16px; color:#64748b; font-size:13px;">Hozircha auksion yo'q.</div>`;
      return;
    }

    listEl.innerHTML = adminAuctionsCache.map(a => {
      const endsAt = a.ends_at ? new Date(a.ends_at) : null;
      const endsStr = endsAt && !isNaN(endsAt.getTime())
        ? endsAt.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '-';
      const thumb = a.prize_photo
        ? `<img src="${escapeHtml(a.prize_photo)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.textContent='IMG';">`
        : `<span class="topsxema-admin-auc-thumb-icon">${ICONS.gift}</span>`;
      const isActive = a.status === 'ACTIVE';

      return `
        <div class="topsxema-admin-auc-row">
          <div class="topsxema-admin-auc-thumb">${thumb}</div>
          <div class="topsxema-admin-auc-info">
            <div class="topsxema-admin-auc-name">#${a.id} · ${escapeHtml(a.title || 'Auksion')}</div>
            <div class="topsxema-admin-auc-sub">@${escapeHtml(a.instagram_username || '-')} · ${escapeHtml(a.audience_size || 'qamrov ko\'rsatilmagan')}</div>
            <div class="topsxema-admin-auc-meta">
              <span>${ICONS.coin} ${formatMoney(a.current_bid)}</span>
              <span>${ICONS.users} ${a.players_count || 0}</span>
              <span>${ICONS.chart} ${a.bids_count || 0} stavka</span>
            </div>
            <div class="topsxema-admin-auc-ends">${ICONS.clock} Tugash: ${endsStr}${a.winner_name ? ' · G\'olib: ' + escapeHtml(a.winner_name) : ''}${a.refunded_at ? ' · Refund qilindi' : ''}</div>
          </div>
          <div class="topsxema-admin-auc-side">
            ${auctionStatusBadge(a.status)}
            <div class="topsxema-admin-auc-actions">
              <button class="topsxema-admin-mini-btn" data-act="edit" data-id="${a.id}">${ICONS.edit} Tahrirlash</button>
              ${isActive ? `
                <button class="topsxema-admin-mini-btn" data-act="end" data-id="${a.id}">${ICONS.trophy} Yakunlash</button>
                <button class="topsxema-admin-mini-btn danger" data-act="cancel" data-id="${a.id}">${ICONS.close} Bekor qilish</button>
              ` : `
                <button class="topsxema-admin-mini-btn" data-act="reopen" data-id="${a.id}">${ICONS.play} Qayta ochish</button>
              `}
              ${!a.refunded_at ? `<button class="topsxema-admin-mini-btn warn" data-act="refund" data-id="${a.id}">${ICONS.undo} Refund</button>` : ''}
              ${a.winner_name ? `<button class="topsxema-admin-mini-btn" data-act="dismiss" data-id="${a.id}">${ICONS.eye} G'olibni yashirish</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.topsxema-admin-mini-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.id;
        const act = btn.dataset.act;
        const auc = adminAuctionsCache.find(a => String(a.id) === String(id));

        if (act === 'edit') {
          editingAuctionId = id;
          editingPrizePhoto = (auc && auc.prize_photo) ? auc.prize_photo : '';
          renderAdminPageContent();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        if (act === 'end' && !confirm("Auksionni hoziroq yakunlab g'olibni tasdiqlaysizmi?")) return;
        if (act === 'cancel' && !confirm("Auksionni bekor qilib barcha pulni qaytarmoqchimisiz?")) return;
        if (act === 'refund' && !confirm("Barcha ishtirokchilarning stavkalari qaytariladimi?")) return;

        const routes = {
          end: `/api/auctions/${id}/end`,
          cancel: `/api/auctions/${id}/cancel`,
          reopen: `/api/auctions/${id}/reopen`,
          refund: `/api/auctions/${id}/refund`,
          dismiss: `/api/auctions/${id}/dismiss-winner`
        };
        const route = routes[act];
        if (!route) return;

        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `${ICONS.spinner}`;

        try {
          const body = { adminTgId: currentTgUser.id };
          if (act === 'reopen') body.durationHours = (auc && auc.duration_hours) || 2;
          const res = await fetch(route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const json = await res.json();
          if (json.success) {
            showToast(json.message || "Muvaffaqiyatli");
            await loadAuctionData();
            renderAuctionArena();
            await loadAdminAuctions();
          } else {
            showToast(json.error || "Xatolik", false);
          }
        } catch (e) {
          showToast("Aloqa xatosi", false);
        } finally {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        }
      };
    });
  }

  // =========================================================================
  // ADMIN: ATMETKA SOZLAMALARI
  // =========================================================================
  function renderAdminTagTab(container) {
    container.innerHTML = `
      <div class="topsxema-admin-card">
        <div class="topsxema-admin-card-header">
          <div class="topsxema-admin-card-title">${ICONS.tag} Atmetka Sozlamalari</div>
        </div>

        <div style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label class="topsxema-form-label">Instagram Target Username:</label>
            <input type="text" id="adm-tag-user" class="topsxema-admin-input" value="${escapeHtml(demoSettings.targetUsername)}">
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
            <div>
              <label class="topsxema-form-label">500k Standart Stavka (UZS):</label>
              <input type="number" id="adm-tag-rate-std" class="topsxema-admin-input" value="${demoSettings.rateStandard500k}">
            </div>
            <div>
              <label class="topsxema-form-label">500k Kalit So'zli Stavka (UZS):</label>
              <input type="number" id="adm-tag-rate-extra" class="topsxema-admin-input" value="${demoSettings.rateExtraWord500k}">
            </div>
          </div>

          <div>
            <label class="topsxema-form-label">Kalit So'z (#hashtag):</label>
            <input type="text" id="adm-tag-keyword" class="topsxema-admin-input" value="${escapeHtml(demoSettings.extraWordKeyword)}">
          </div>

          <div>
            <label class="topsxema-form-label">Kunlik Byudjet Limiti (UZS):</label>
            <input type="number" id="adm-tag-budget" class="topsxema-admin-input" value="${demoSettings.dailyBudget}">
          </div>

          <div>
            <label class="topsxema-form-label">Qoidalar Matni:</label>
            <textarea id="adm-tag-rules" class="topsxema-admin-textarea">${escapeHtml(demoSettings.rulesText)}</textarea>
          </div>

          <button id="btn-adm-save-tag" class="topsxema-admin-save-btn">
            ${ICONS.check} Sozlamalarni Saqlash
          </button>
        </div>
      </div>
    `;

    container.querySelector('#btn-adm-save-tag').onclick = async () => {
      const u = adminFieldValue('adm-tag-user');
      const rStd = parseInt(adminFieldValue('adm-tag-rate-std'), 10);
      const rExt = parseInt(adminFieldValue('adm-tag-rate-extra'), 10);
      const kw = adminFieldValue('adm-tag-keyword');
      const bg = parseInt(adminFieldValue('adm-tag-budget'), 10);
      const rules = adminFieldValue('adm-tag-rules');

      try {
        const res = await fetch('/api/demo/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminTgId: currentTgUser.id,
            targetUsername: u,
            rateStandard500k: rStd,
            rateExtraWord500k: rExt,
            extraWordKeyword: kw,
            dailyBudget: bg,
            rulesText: rules
          })
        });
        const json = await res.json();
        if (json.success) {
          showToast("Atmetka sozlamalari saqlandi!");
          await loadSettings();
        } else showToast(json.error || "Xatolik", false);
      } catch (e) { showToast("Aloqa xatosi", false); }
    };
  }

  // =========================================================================
  // ADMIN: BYUDJET (jonli tahrirlash + to'ldirish + pul ayriish)
  // =========================================================================
  function renderAdminBudgetTab(container) {
    const daily = Number(demoSettings.dailyBudget || 1000000);
    const remaining = Number(demoSettings.remainingBudget !== undefined ? demoSettings.remainingBudget : daily);
    const spent = Number(demoSettings.spentBudget || 0);
    const isManual = !!demoSettings.spentIsManual;

    container.innerHTML = `
        <div class="topsxema-admin-card">
          <div class="topsxema-admin-card-header">
            <div class="topsxema-admin-card-title">${ICONS.wallet} Jonli Byudjet</div>
          </div>

          <div class="topsxema-admin-budget-grid">
            <div class="topsxema-admin-budget-cell">
              <span>Kunlik Byudjet</span>
              <b>${formatMoney(daily)}</b>
            </div>
            <div class="topsxema-admin-budget-cell">
              <span>Sarflangan</span>
              <b style="color:#ef4444;">${formatMoney(spent)}</b>
            </div>
            <div class="topsxema-admin-budget-cell">
              <span>Qolgan</span>
              <b style="color:#10b981;">${formatMoney(remaining)}</b>
            </div>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px; margin-top:14px;">
            <div>
              <label class="topsxema-form-label">Kunlik Byudjet (UZS):</label>
              <input type="number" id="adm-budget-daily" class="topsxema-admin-input" value="${daily}">
            </div>

            <div>
              <label class="topsxema-form-label">Sarflangan Summa (qo'lda boshqarish):</label>
              <input type="number" id="adm-budget-spent" class="topsxema-admin-input" value="${isManual ? spent : ''}" placeholder="${isManual ? spent : 'Bo\'sh = avtomatik hisoblanadi'}">
              <p style="font-size:11px; color:#64748b; margin:6px 0 0;">${ICONS.refresh} Bo'sh qoldirilsa, sarflangan summa avtomatik hisoblanadi.</p>
            </div>

            <button id="btn-adm-save-budget" class="topsxema-admin-save-btn">
              ${ICONS.check} Byudjetni Saqlash
            </button>
          </div>
        </div>

        <div class="topsxema-admin-card">
          <div class="topsxema-admin-card-header">
            <div class="topsxema-admin-card-title">${ICONS.plus} Foydalanuvchi Balansini To'ldirish</div>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label class="topsxema-form-label">Foydalanuvchi Telegram ID:</label>
              <input type="number" id="adm-topup-tgid" class="topsxema-admin-input" placeholder="Masalan: 8897050018">
            </div>

            <div>
              <label class="topsxema-form-label">To'ldirish Summasi (UZS):</label>
              <input type="number" id="adm-topup-amount" class="topsxema-admin-input" placeholder="Masalan: 100000" value="100000">
            </div>

            <button id="btn-adm-exec-topup" class="topsxema-admin-save-btn">
              ${ICONS.wallet} Balansga Pul O'tkazish
            </button>
          </div>
        </div>

        <div class="topsxema-admin-card" style="border-color: rgba(239, 68, 68, 0.35);">
          <div class="topsxema-admin-card-header">
            <div class="topsxema-admin-card-title" style="color:#fca5a5;">${ICONS.arrowDownLeft} Pul Ayriish (Balansdan yechish)</div>
          </div>

          <div style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label class="topsxema-form-label">Foydalanuvchi Telegram ID:</label>
              <input type="number" id="adm-debit-tgid" class="topsxema-admin-input" placeholder="Masalan: 8897050018">
            </div>

            <div>
              <label class="topsxema-form-label">Ayiriladigan Summa (UZS):</label>
              <input type="number" id="adm-debit-amount" class="topsxema-admin-input" placeholder="Masalan: 25000" value="25000">
            </div>

            <button id="btn-adm-exec-debit" class="topsxema-admin-save-btn" style="background:linear-gradient(135deg,#ef4444,#b91c1c);">
              ${ICONS.arrowDownLeft} Pulni Ayirish
            </button>
          </div>
        </div>
    `;

    container.querySelector('#btn-adm-save-budget').onclick = async () => {
      const dailyVal = adminFieldValue('adm-budget-daily');
      const spentVal = adminFieldValue('adm-budget-spent');
      const body = { adminTgId: currentTgUser.id, spentBudgetOverride: spentVal };
      if (dailyVal !== '') body.dailyBudget = parseInt(dailyVal, 10);

      try {
        const res = await fetch('/api/demo/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const json = await res.json();
        if (json.success) {
          showToast("Byudjet yangilandi!");
          await loadSettings();
          renderAdminPageContent();
        } else showToast(json.error || "Xatolik", false);
      } catch (e) { showToast("Aloqa xatosi", false); }
    };

    container.querySelector('#btn-adm-exec-topup').onclick = async () => {
      const targetTg = adminFieldValue('adm-topup-tgid');
      const amt = parseInt(adminFieldValue('adm-topup-amount'), 10);
      if (!targetTg || !amt || amt <= 0) return showToast("ID va summani kiriting", false);

      try {
        const res = await fetch('/api/demo/wallets/topup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminTgId: currentTgUser.id,
            targetTelegramId: targetTg,
            amount: amt
          })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message);
          document.getElementById('adm-topup-tgid').value = '';
        } else showToast(json.error || "Xatolik", false);
      } catch (e) { showToast("Aloqa xatosi", false); }
    };

    container.querySelector('#btn-adm-exec-debit').onclick = async () => {
      const targetTg = adminFieldValue('adm-debit-tgid');
      const amt = parseInt(adminFieldValue('adm-debit-amount'), 10);
      if (!targetTg || !amt || amt <= 0) return showToast("ID va summani kiriting", false);

      try {
        const res = await fetch('/api/demo/wallets/debit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminTgId: currentTgUser.id,
            targetTelegramId: targetTg,
            amount: amt,
            note: 'Admin panel: pul ayriish'
          })
        });
        const json = await res.json();
        if (json.success) {
          showToast(json.message);
          document.getElementById('adm-debit-tgid').value = '';
        } else showToast(json.error || "Xatolik", false);
      } catch (e) { showToast("Aloqa xatosi", false); }
    };
  }

  // =========================================================================
  // ADMIN: FOYDALANUVCHILAR FIKRLARI
  // =========================================================================
  async function renderAdminFeedbacksTab(container) {
    container.innerHTML = `
      <div class="topsxema-admin-card">
        <div class="topsxema-admin-card-header">
          <div class="topsxema-admin-card-title">${ICONS.lightbulb} Foydalanuvchilar Fikrlari & G'oyalari</div>
        </div>
        <div id="admin-feedbacks-list" style="margin-top:12px;">
          <div style="text-align:center; padding:20px; color:#64748b; font-size:13px;">Yuklanmoqda...</div>
        </div>
      </div>
    `;

    try {
      const res = await fetch('/api/demo/feedback');
      const data = await res.json();
      const listEl = document.getElementById('admin-feedbacks-list');
      if (!listEl) return;

      if (!data.success || !data.feedbacks || data.feedbacks.length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#64748b; font-size:13px;">Hozircha xabarlar yo'q.</div>`;
        return;
      }

      listEl.innerHTML = data.feedbacks.map(f => {
        let badgeBg = 'rgba(251, 191, 36, 0.15)';
        let badgeColor = '#fbbf24';
        if (f.category === 'Muammo') {
          badgeBg = 'rgba(239, 68, 68, 0.15)';
          badgeColor = '#ef4444';
        } else if (f.category === 'Fikr') {
          badgeBg = 'rgba(14, 165, 233, 0.15)';
          badgeColor = '#0ea5e9';
        }

        const d = new Date(f.created_at);
        const timeStr = d.toLocaleDateString('uz-UZ') + ' ' + d.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

        return `
          <div class="topsxema-feedback-card">
            <div class="topsxema-feedback-top">
              <span class="topsxema-feedback-user">${escapeHtml(f.user_name || 'Foydalanuvchi')} (ID: ${escapeHtml(f.telegram_id || 'N/A')})</span>
              <span class="topsxema-feedback-badge" style="background:${badgeBg}; color:${badgeColor};">${escapeHtml(f.category)}</span>
            </div>
            <div class="topsxema-feedback-msg">${escapeHtml(f.message)}</div>
            <div class="topsxema-feedback-time">${timeStr}</div>
          </div>
        `;
      }).join('');
    } catch (fErr) {
      const listEl = document.getElementById('admin-feedbacks-list');
      if (listEl) listEl.innerHTML = `<div style="color:#ef4444; padding:12px; font-size:13px;">Fikrlarni yuklashda xatolik yuz berdi.</div>`;
    }
  }

  // =========================================================================
  // RENDER AUCTION ARENA (Empty State Sticker, Prize Banner, Podium, Presets)
  // =========================================================================
  function renderAuctionArena() {
    const arena = document.getElementById('portal-arena-wrapper');
    if (!arena) return;

    const isAdmin = isUserAdmin();

    // 1. EMPTY STATE: When NO auction is active
    if (!currentAuction || currentAuction.status === 'CANCELLED') {
      arena.innerHTML = `
        <div class="portals-empty-state-wrap">
          <div id="empty-auction-lottie-container"></div>
          <h3 class="portals-empty-title">Hozirda faol auksion yo'q</h3>
          <p class="portals-empty-desc">Yangi hammualliflik (Collab) auksioni tez orada e'lon qilinadi!</p>
          
          <div style="margin: 14px 0;">
            <button id="btn-open-user-feedback" class="portals-feedback-pill-btn">
              ${ICONS.lightbulb} Fikr & G'oyalar bildirish
            </button>
          </div>

          ${isAdmin ? `
            <div class="portals-empty-admin-actions">
              <button id="btn-admin-open-create-modal" class="portals-admin-create-btn" style="padding:12px 20px; font-size:13.5px; border-radius:14px;">
                + Yangi Auksion Yaratish
              </button>
              <button id="btn-admin-open-panel-page" class="topsxema-admin-open-btn" style="padding:10px 18px; justify-content:center; border-radius:14px; margin-top:4px;">
                ${ICONS.settings} <span>Admin Boshqaruv Paneli</span>
              </button>
            </div>
          ` : ''}
        </div>
      `;

      // Mount Telegram Animated Sticker
      const lottieContainer = document.getElementById('empty-auction-lottie-container');
      if (lottieContainer && window.bodymovin) {
        try {
          window.bodymovin.loadAnimation({
            container: lottieContainer,
            renderer: 'svg',
            loop: true,
            autoplay: true,
            path: '/assets/empty_auction_sticker.json'
          });
        } catch (lErr) {
          console.warn("Lottie sticker load error:", lErr);
        }
      }

      const fbBtn = document.getElementById('btn-open-user-feedback');
      if (fbBtn) fbBtn.onclick = () => openFeedbackModal();

      if (isAdmin) {
        setupAdminCreateButton();
        const pBtn = document.getElementById('btn-admin-open-panel-page');
        if (pBtn) pBtn.onclick = () => openAdminPage();
      }
      return;
    }

    const auc = currentAuction;
    const isCompleted = auc.status === 'COMPLETED' || (new Date(auc.ends_at).getTime() <= serverNow());

    // 2. COMPLETED STATE: Winner Announcement & Details
    if (isCompleted) {
      const winnerName = auc.winner_name || (auc.players && auc.players[0] ? auc.players[0].user_name : 'G\'olib');
      const winnerAvatar = auc.winner_avatar || (auc.players && auc.players[0] ? auc.players[0].user_avatar : '');
      const winBid = Number(auc.current_bid || auc.starting_price || 50000);
      const isWinner = currentTgUser && (String(auc.winner_telegram_id) === String(currentTgUser.id));

      // G'olib kartasi 60 daqiqa ko'rinadi (yoki admin X bosguncha)
      const visibleUntil = auc.winner_visible_until ? new Date(auc.winner_visible_until).getTime() : 0;
      const expired = visibleUntil > 0 && serverNow() > visibleUntil;
      const showWinnerCard = !auc.winner_dismissed && !expired;
      const hideIn = visibleUntil > 0 ? Math.max(0, visibleUntil - serverNow()) : 0;
      const hideM = Math.floor(hideIn / 60000);
      const hideS = Math.floor((hideIn % 60000) / 1000);
      const hideStr = `${hideM}:${String(hideS).padStart(2, '0')}`;

      if (!showWinnerCard) {
        arena.innerHTML = `
          <div class="portals-winner-collapsed">
            <span class="portals-winner-collapsed-icon">${ICONS.trophy}</span>
            <div class="portals-winner-collapsed-text">
              <b>Auksion yakunlandi</b>
              <span>Yutuq: @${escapeHtml(auc.instagram_username || '-')}</span>
            </div>
            ${isAdmin ? `<button id="btn-admin-open-panel-page" class="topsxema-admin-open-btn">${ICONS.settings}<span>Admin</span></button>` : ''}
          </div>
        `;
        const pBtn = document.getElementById('btn-admin-open-panel-page');
        if (pBtn) pBtn.onclick = () => openAdminPage();
        return;
      }

      arena.innerHTML = `
        <div class="portals-winner-card" style="background:linear-gradient(180deg, rgba(25, 22, 10, 0.98), rgba(15, 17, 26, 0.98)); border:2px solid #eab308; border-radius:24px; padding:26px 18px; text-align:center; box-shadow:0 16px 48px rgba(234, 179, 8, 0.25); margin-bottom:16px;">
          <div style="color:#fbbf24; margin-bottom:8px;">${ICONS.crown}</div>
          <h2 style="font-size:18px; font-weight:800; color:#fff; margin:0 0 12px; letter-spacing:0.5px; display:flex; align-items:center; justify-content:center; gap:8px;">
            ${ICONS.trophy} AUKSION YAKUNLANDI
          </h2>

          <div style="position:relative; width:84px; height:84px; margin:0 auto 12px; border-radius:50%; border:3px solid #fbbf24; overflow:hidden; box-shadow:0 0 25px rgba(251, 191, 36, 0.5); background:linear-gradient(140deg,#4DA3FF,#6E7BF2 55%,#8B5CF6); display:flex; align-items:center; justify-content:center;">
            ${winnerAvatar
              ? `<img src="${escapeHtml(winnerAvatar)}" alt="" referrerpolicy="no-referrer" style="width:100%; height:100%; object-fit:cover;">`
              : `<span style="font-size:32px; font-weight:800; color:#fff;">${escapeHtml((winnerName || '?').slice(0, 1).toUpperCase())}</span>`}
          </div>

          <div style="font-size:17px; font-weight:800; color:#fff; margin-bottom:4px;">${escapeHtml(winnerName)}</div>
          <div style="font-size:12px; color:#fbbf24; font-weight:700; margin-bottom:12px;">AUKSION G'OLIBI</div>

          <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.08); border-radius:16px; padding:12px; margin-bottom:14px; text-align:left;">
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12.5px;">
              <span style="color:#94a3b8;">Yutilgan Slot:</span>
              <span style="color:#fff; font-weight:700;">@${escapeHtml(auc.instagram_username)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:12.5px;">
              <span style="color:#94a3b8;">G'olib Stavka:</span>
              <span style="color:#fbbf24; font-weight:800;">${formatMoney(winBid)}</span>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:12.5px;">
              <span style="color:#94a3b8;">Auksion Moderatori:</span>
              <span style="color:#38bdf8; font-weight:700;">${escapeHtml(auc.admin_name || 'Admin')}</span>
            </div>
          </div>

          ${isWinner ? `
            <div style="background:rgba(16, 185, 129, 0.15); border:1px solid rgba(16, 185, 129, 0.4); border-radius:14px; padding:12px; color:#10b981; font-size:13px; font-weight:700; margin-bottom:12px; display:flex; align-items:center; gap:8px; justify-content:center;">
              ${ICONS.spark} Tabriklaymiz! Siz g'olib bo'ldingiz! Videongizni joylash uchun admin bilan bog'laning.
            </div>
          ` : `
            <div style="background:rgba(56, 189, 248, 0.1); border:1px solid rgba(56, 189, 248, 0.25); border-radius:14px; padding:10px; color:#38bdf8; font-size:12px; font-weight:600; margin-bottom:12px; display:flex; align-items:center; gap:8px; justify-content:center;">
              ${ICONS.coin} Barcha ishtirokchilarning stavka summalari o'z balanslariga 100% to'liq qaytarildi!
            </div>
          `}

          <div style="display:flex; flex-direction:column; gap:8px;">
            <a href="${escapeHtml(safeInstagramUrl(auc))}" target="_blank" rel="noopener noreferrer" class="portals-prize-open-ig-btn" style="margin:0;">
              ${ICONS.externalLink} Instagram Profilini Ko'rish
            </a>
          </div>

          ${visibleUntil > 0 ? `
            <div class="portals-winner-hide-timer">
              ${ICONS.hourglass} Yashirilishiga: ${hideStr}
            </div>
          ` : ''}

          ${isAdmin ? `
            <button id="btn-admin-dismiss-winner" class="topsxema-admin-exit-btn" style="width:100%; margin-top:10px;">
              ${ICONS.close} G'olib kartasini yashirish (X)
            </button>
          ` : ''}

          ${isAdmin ? `
            <button id="btn-admin-restart-auc" class="topsxema-admin-save-btn" style="width:100%; margin-top:8px;">
              ${ICONS.plus} Yangi Auksion Boshlash
            </button>
          ` : ''}
        </div>
      `;

      if (isAdmin) {
        const rBtn = document.getElementById('btn-admin-restart-auc');
        if (rBtn) rBtn.onclick = () => openAdminPage();

        const dBtn = document.getElementById('btn-admin-dismiss-winner');
        if (dBtn) {
          dBtn.onclick = async () => {
            dBtn.disabled = true;
            try {
              const res = await fetch(`/api/auctions/${auc.id}/dismiss-winner`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminTgId: currentTgUser.id })
              });
              const json = await res.json();
              if (json.success) {
                showToast(json.message || "G'olib kartasi yashirildi");
                await loadAuctionData();
                renderAuctionArena();
              } else {
                showToast(json.error || "Xatolik", false);
              }
            } catch (e) {
              showToast("Aloqa xatosi", false);
            } finally {
              dBtn.disabled = false;
            }
          };
        }
      }

      // 60 daqiqa o'tganda kartani avtomatik yashirish
      if (visibleUntil > 0) scheduleWinnerAutoHide(visibleUntil);
      return;
    }

    // 3. ACTIVE AUCTION STATE:
    const players = auc.players || [];
    const minStep = Number(auc.min_step !== undefined ? auc.min_step : 10000);
    const minNextBid = (minStep > 0) ? (Number(auc.current_bid || auc.starting_price || 50000) + minStep) : (Number(auc.current_bid || auc.starting_price || 50000) + 10000);

    arena.innerHTML = `
      <!-- 1. Prize Info Banner Card ("yutuq bosganda barchasi chiqib kelishi kerak") -->
      <div class="portals-prize-banner-btn" id="btn-show-prize-details">
        <div class="portals-prize-banner-left">
          <div class="portals-prize-banner-icon">
            ${ICONS.gift}
            ${auc.prize_photo ? `<img src="${escapeHtml(auc.prize_photo)}" class="portals-prize-banner-photo" alt="" referrerpolicy="no-referrer" onerror="this.remove();">` : ''}
          </div>
          <div class="portals-prize-banner-text">
            <div class="portals-prize-banner-title">
              <span>Collab Sloti:</span> @${escapeHtml(auc.instagram_username)}
            </div>
            <div class="portals-prize-banner-sub">
              ${escapeHtml(auc.audience_size || 'Ma\'lumot va qoidalar')} ›
            </div>
          </div>
        </div>
        <div class="portals-prize-banner-arrow">
          ${ICONS.chevron}
        </div>
      </div>

      <!-- 2. Rectangular 4K Comparative Screen -->
      <div class="portals-screen-card">
        <canvas id="portal-wheel-canvas" width="720" height="540"></canvas>
      </div>

      <!-- 3. Players Header Bar with Feedback & Admin Action -->
      <div class="portals-players-header">
        <div class="portals-players-title">
          Players <span>· ${players.length}</span>
        </div>
        <div class="portals-players-header-right">
          <button id="btn-open-user-feedback" class="portals-feedback-pill-btn" style="padding:4px 8px; font-size:11px;">
            ${ICONS.lightbulb} G'oya
          </button>
          <div class="portals-game-id">Game #${auc.id}</div>
          ${isAdmin ? `<button id="btn-admin-open-panel-page" class="portals-admin-create-btn">Boshqaruv Paneli</button>` : ''}
        </div>
      </div>

      <!-- 4. Player Cards List -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        ${renderPlayersList(players)}
      </div>

      <!-- 5. Floating Bottom Action Dock (sits at bottom: 64px above navigation) -->
      <div class="portals-bottom-dock">
        <div class="portals-dock-top-row">
          <div class="portals-balance-chip">
            <span class="portals-svg-inline">${ICONS.shield}</span>
            <span id="portal-user-balance">Hamyon: ${formatMoney(currentUserBalance)}</span>
          </div>
          <div class="portals-timer-chip">
            <span class="portals-timer-label">VAQT:</span>
            <span class="portals-timer-val" id="portal-center-timer">${ICONS.clock} 00:00:00</span>
          </div>
        </div>

        <!-- Quick Preset Chips -->
        <div class="portals-dock-presets-row">
          <button class="portals-preset-chip" data-add="10000">+10,000 UZS</button>
          <button class="portals-preset-chip" data-add="50000">+50,000 UZS</button>
          <button class="portals-preset-chip" data-add="100000">+100,000 UZS</button>
          <button class="portals-preset-chip" data-add="250000">+250,000 UZS</button>
        </div>

        <!-- Aniq Tiniq Summa Input va Tikish Tugmasi -->
        <div class="portals-dock-action-row">
          <div class="portals-input-container">
            <input type="number" id="portal-custom-bid-input" class="portals-amount-input" placeholder="${minStep > 0 ? 'Minimal: ' + minNextBid : 'Istalgan summa'}" value="${pendingBidAmount !== null && pendingBidAmount > 0 ? pendingBidAmount : minNextBid}" min="${minStep > 0 ? minNextBid : 1000}" inputmode="numeric">
            <span class="portals-uzs-tag">UZS</span>
          </div>
          <button id="portal-place-bid-btn" class="portals-bid-btn-green">
            ${ICONS.coin} Tikish
          </button>
        </div>
      </div>
    `;

    // Hook Prize Details Modal
    const prizeBtn = document.getElementById('btn-show-prize-details');
    if (prizeBtn) {
      prizeBtn.onclick = () => openPrizeModal(auc);
    }

    // Hook Feedback Button
    const fbBtn = document.getElementById('btn-open-user-feedback');
    if (fbBtn) {
      fbBtn.onclick = () => openFeedbackModal();
    }

    // Hook Quick Preset Chips
    const presetBtns = arena.querySelectorAll('.portals-preset-chip');
    presetBtns.forEach(btn => {
      btn.onclick = () => {
        const addAmt = parseInt(btn.dataset.add, 10);
        const input = document.getElementById('portal-custom-bid-input');
        if (input && addAmt) {
          const currentVal = parseInt(input.value, 10) || minNextBid;
          input.value = currentVal + addAmt;
          if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
          }
        }
      };
    });

    setupAuctionInteractions();
    if (isAdmin) {
      const pBtn = document.getElementById('btn-admin-open-panel-page');
      if (pBtn) pBtn.onclick = () => openAdminPage();
    }
    startCountdown(auc.ends_at);
    startWheelAnimation(players);
    syncDockOffset();
  }
  function renderPlayersList(players) {
    if (!players || players.length === 0) {
      return `<div class="ppc-empty">Hozircha stavka qo'yilmagan.<br>Birinchi bo'ling! 🎯</div>`;
    }

    const MEDALS = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
    const totalPot = players.reduce((s,p) => s + Number(p.totalBid || p.total_bid || 0), 0);

    return players.map((p, idx) => {
      const color   = WHEEL_COLORS[idx % WHEEL_COLORS.length];
      const initial = (p.userName || p.user_name || 'U').slice(0,1).toUpperCase();
      const hasPhoto = !!(p.userAvatar || p.user_avatar);
      const photoSrc = escapeHtml(p.userAvatar || p.user_avatar || '');
      const name    = escapeHtml(p.userName || p.user_name || 'Ishtirokchi');
      const bid     = Number(p.totalBid || p.total_bid || 0);
      const pctRaw  = totalPot > 0 ? (bid / totalPot * 100) : 0;
      const pct     = pctRaw.toFixed(1);
      const isLeader = idx === 0;

      // Format amount: 1 500 000 → "1.5 mln", 50000 → "50 ming", else plain
      function fmtBid(n) {
        if (n >= 1000000) {
          const m = n / 1000000;
          return (Number.isInteger(m) ? m : m.toFixed(1)) + ' mln';
        }
        if (n >= 1000) {
          const k = n / 1000;
          return (Number.isInteger(k) ? k : k.toFixed(0)) + ' ming';
        }
        return n.toLocaleString('uz-UZ');
      }

      const rankHtml = idx < 3
        ? `<span class="ppc-rank">${MEDALS[idx]}</span>`
        : `<span class="ppc-rank ppc-rank-num">#${idx+1}</span>`;

      const crownHtml = isLeader ? `<span class="ppc-crown">\uD83D\uDC51</span>` : '';

      const avatarInner = hasPhoto
        ? `<img src="${photoSrc}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
        : initial;

      return `
        <div class="ppc-card${isLeader ? ' ppc-card--leader' : ''}">
          <div class="ppc-main">
            ${rankHtml}
            <div class="ppc-av" style="background:${hasPhoto ? 'rgba(0,0,0,0.3)' : color};border-color:${color};">
              ${crownHtml}${avatarInner}
            </div>
            <div class="ppc-info">
              <div class="ppc-name">${name}</div>
              <div class="ppc-meta">
                <span class="ppc-dot" style="background:${color};"></span>
                <span class="ppc-pct">${pct}%</span>
              </div>
            </div>
            <div class="ppc-right">
              <span class="ppc-amount">${fmtBid(bid)}</span>
              <span class="ppc-cur">UZS</span>
            </div>
          </div>
          <div class="ppc-bar"><div class="ppc-bar-fill" style="width:${Math.max(2,Math.min(100,pctRaw)).toFixed(1)}%;background:${color};"></div></div>
        </div>
      `;
    }).join('');
  }

  // Pastki navigatsiya paneli balandligini aniqlab, tikish (dock) panelini
// undan yuqoriga surish — tikish tugmasi yashirilmasin.
  function syncDockOffset() {
    const dock = document.querySelector('.portals-bottom-dock');
    if (!dock) return;

    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let need = 0;

    // elementFromPoint ishlatilmaydi: dock z-index balandligi uchun
    // probe har doim dockning o'zini ushlab qoladi. Balki fixed
    // elementlarni to'g'ridan-to'g'ri tekshiramiz.
    const candidates = document.querySelectorAll('div, nav, header, footer, aside, section, ul');
    for (const el of candidates) {
      if (el === dock || dock.contains(el) || el.contains(dock)) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.5) continue;
      if (r.height < 20 || r.height > vh * 0.5) continue;
      if (r.bottom < vh * 0.5 || r.top > vh) continue;
      const gap = vh - r.top + 10;
      if (gap > need) need = gap;
    }

    dock.style.bottom = Math.min(260, Math.max(64, need)) + 'px';
  }

  function setupAuctionInteractions() {
    const input = document.getElementById('portal-custom-bid-input');
    const bidBtn = document.getElementById('portal-place-bid-btn');

    if (!bidBtn || !input) return;

    // Foydalanuvchi kiritgan summani saqlaymiz — ekranda yangilanishda yo'qolmasin
    input.oninput = () => {
      const v = parseInt(input.value, 10);
      pendingBidAmount = Number.isFinite(v) ? v : null;
    };

    bidBtn.onclick = async () => {
      if (bidInFlight) return;

      const amt = parseInt(input.value, 10);
      if (!amt || amt <= 0) {
        showToast("Noto'g'ri summa kiritildi", false);
        return;
      }

      // Minimal stavka — serverga yuborishdan oldin tekshiramiz (xato oqimini kamaytirish uchun)
      const minStep = Number(currentAuction?.min_step || 0);
      const baseBid = Number(currentAuction?.current_bid || currentAuction?.starting_price || 0);
      const minAllowed = minStep > 0 ? baseBid + minStep : baseBid;
      if (amt < minAllowed) {
        showToast(`Minimal stavka: ${minAllowed.toLocaleString('uz-UZ')} UZS`, false);
        input.value = minAllowed;
        pendingBidAmount = minAllowed;
        return;
      }

      if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('heavy');
      }

      bidInFlight = true;
      pendingBidAmount = amt;
      bidBtn.disabled = true;
      bidBtn.innerHTML = `${ICONS.spinner} Yuborilmoqda...`;

      try {
        const res = await fetch(`/api/auctions/${currentAuction.id}/bid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: amt,
            telegramId: currentTgUser.id,
            userName: (currentTgUser.first_name ? currentTgUser.first_name + ' ' + (currentTgUser.last_name || '') : 'Player').trim(),
            userAvatar: currentTgUser.photo_url || ''
          })
        });
        const json = await res.json();
        if (json.success) {
          showToast("Stavka muvaffaqiyatli qabul qilindi!");
          // Yangi minimal summa ko'rsatilsin
          pendingBidAmount = null;
          await loadAuctionData();
          renderAuctionArena();
        } else {
          showToast(json.error || "Stavka qo'yib bo'lmadi", false);
        }
      } catch (e) {
        showToast("Aloqa xatosi: " + e.message, false);
      } finally {
        bidInFlight = false;
        const activeBtn = document.getElementById('portal-place-bid-btn');
        if (activeBtn) {
          activeBtn.disabled = false;
          activeBtn.innerHTML = `${ICONS.coin} Tikish`;
        }
      }
    };
  }

  function setupAdminCreateButton() {
    const btn = document.getElementById('btn-admin-open-create-modal');
    if (!btn) return;

    btn.onclick = () => {
      let modal = document.getElementById('admin-auction-create-modal');
      if (modal) modal.remove();

      modal = document.createElement('div');
      modal.id = 'admin-auction-create-modal';
      modal.className = 'topsxema-admin-modal-overlay';
      modal.style.display = 'flex';
      modal.innerHTML = `
        <div class="topsxema-admin-modal-dialog">
          <div class="topsxema-admin-modal-header">
            <div class="topsxema-admin-modal-header-left">
              <span class="topsxema-admin-modal-header-icon">${ICONS.trophy}</span>
              <div class="topsxema-admin-modal-title">Yangi Auksion Yaratish</div>
            </div>
            <button class="topsxema-admin-close-btn" id="admin-close-auc-modal">${ICONS.close}</button>
          </div>
          <div class="topsxema-admin-modal-body" style="display:flex; flex-direction:column; gap:12px;">
            <div>
              <label style="font-size:12px; color:#94a3b8; font-weight:700;">Auksion nomi / Slot tavsifi:</label>
              <input type="text" id="auc-new-title" class="topsxema-admin-input" placeholder="Auksion nomi / Slot tavsifi" value="" style="margin-top:4px;">
            </div>
            <div>
              <label style="font-size:12px; color:#94a3b8; font-weight:700;">Instagram akkaunt username (@bilan):</label>
              <input type="text" id="auc-new-ig" class="topsxema-admin-input" placeholder="@username" value="" style="margin-top:4px;">
            </div>
            <div style="display:flex; gap:10px;">
              <div style="flex:1;">
                <label style="font-size:12px; color:#94a3b8; font-weight:700;">Boshlang'ich narx (UZS):</label>
                <input type="number" id="auc-new-price" class="topsxema-admin-input" value="50000" style="margin-top:4px;">
              </div>
              <div style="flex:1;">
                <label style="font-size:12px; color:#94a3b8; font-weight:700;">Minimal qadam (UZS):</label>
                <input type="number" id="auc-new-step" class="topsxema-admin-input" value="10000" style="margin-top:4px;">
              </div>
            </div>
            <div>
              <label style="font-size:12px; color:#94a3b8; font-weight:700;">Davomiyligi (soat):</label>
              <input type="number" id="auc-new-hours" class="topsxema-admin-input" value="2" style="margin-top:4px;">
            </div>
            <button id="btn-submit-new-auction" class="topsxema-admin-save-btn" style="margin-top:8px;">
              Auksionni Boshlash
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      modal.querySelector('#admin-close-auc-modal').onclick = () => modal.remove();

      modal.querySelector('#btn-submit-new-auction').onclick = async () => {
        const title = modal.querySelector('#auc-new-title').value.trim();
        const instagramUsername = modal.querySelector('#auc-new-ig').value.trim();
        const startingPrice = parseInt(modal.querySelector('#auc-new-price').value, 10);
        const minStep = parseInt(modal.querySelector('#auc-new-step').value, 10);
        const durationHours = parseInt(modal.querySelector('#auc-new-hours').value, 10);

        if (!title || !instagramUsername) return showToast("Barcha maydonlarni to'ldiring", false);
        if (!Number.isFinite(startingPrice) || startingPrice < 0) return showToast("Boshlang'ich narx noto'g'ri", false);
        if (!Number.isFinite(minStep) || minStep < 0) return showToast("Minimal qadam noto'g'ri", false);
        if (!Number.isFinite(durationHours) || durationHours <= 0) return showToast("Davomiylilik noto'g'ri", false);

        try {
          const res = await fetch('/api/auctions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              telegramId: currentTgUser.id,
              title,
              instagramUsername,
              startingPrice,
              minStep,
              durationHours
            })
          });
          const json = await res.json();
          if (json.success) {
            showToast("Yangi auksion muvaffaqiyatli ishga tushirildi!");
            modal.remove();
            await loadAuctionData();
            renderAuctionArena();
          } else {
            showToast(json.error || "Xatolik yuz berdi", false);
          }
        } catch (err) {
          showToast("Aloqa xatosi: " + err.message, false);
        }
      };
    };
  }
  // G'olib kartasi 60 daqiqadan keyin avtomatik yashiriladi
  function scheduleWinnerAutoHide(visibleUntil) {
    if (winnerHideTimer) clearTimeout(winnerHideTimer);
    const delay = Math.max(1000, visibleUntil - serverNow() + 500);
    winnerHideTimer = setTimeout(async () => {
      await loadAuctionData();
      renderAuctionArena();
    }, delay);
  }

  function startCountdown(endsAtStr) {
    if (countdownTimer) clearInterval(countdownTimer);
    const target = new Date(endsAtStr).getTime();
    const valid = Number.isFinite(target);

    function update() {
      const tEl = document.getElementById('portal-center-timer');
      if (!valid) {
        if (tEl) tEl.innerHTML = `${ICONS.clock} --:--:--`;
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      const now = serverNow();
      const diff = Math.max(0, target - now);

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      if (tEl) tEl.innerHTML = `${ICONS.clock} ${clock}`;

      if (diff <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        // Vaqt tugdi — natijani yangilash
        loadAuctionData().then(renderAuctionArena);
      }
    }

    update();
    if (valid) countdownTimer = setInterval(update, 1000);
  }

  // =========================================================================
  // PORTALS 4K RECTANGULAR COMPARATIVE SCREEN (SMOOTH LERP & 100% COVERAGE)
  // =========================================================================
  function startWheelAnimation(players) {
    if (wheelAnimFrame) cancelAnimationFrame(wheelAnimFrame);
    const canvas = document.getElementById('portal-wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // High-DPI Retina Display Setup for 4K Crisp Clarity
    const dpr = Math.min(3, window.devicePixelRatio || 2);
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || 360;
    const cssH = 270;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    function animate() {
      // Smooth LERP interpolation: newly placed or increased bids expand rapidly & smoothly!
      let sumCurrent = 0;
      for (const p of animPlayersState) {
        // Fast, buttery-smooth spring interpolation
        p.currentPct += (p.targetPct - p.currentPct) * 0.12;
        sumCurrent += p.currentPct;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      drawRectangularComparativeScreen(ctx, cssW, cssH, animPlayersState, sumCurrent);
      ctx.restore();

      wheelAnimFrame = requestAnimationFrame(animate);
    }
    animate();
  }

  function getRayRectIntersection(cx, cy, w, h, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let tMin = 1e9;
    let pt = { x: cx, y: cy };

    if (cos > 1e-6) {
      const t = (w - cx) / cos;
      const y = cy + t * sin;
      if (y >= 0 && y <= h && t < tMin) {
        tMin = t;
        pt = { x: w, y };
      }
    }
    if (cos < -1e-6) {
      const t = (0 - cx) / cos;
      const y = cy + t * sin;
      if (y >= 0 && y <= h && t < tMin) {
        tMin = t;
        pt = { x: 0, y };
      }
    }
    if (sin > 1e-6) {
      const t = (h - cy) / sin;
      const x = cx + t * cos;
      if (x >= 0 && x <= w && t < tMin) {
        tMin = t;
        pt = { x, y: h };
      }
    }
    if (sin < -1e-6) {
      const t = (0 - cy) / sin;
      const x = cx + t * cos;
      if (x >= 0 && x <= w && t < tMin) {
        tMin = t;
        pt = { x, y: 0 };
      }
    }
    return pt;
  }

  function drawVectorStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
      x = cx + Math.cos(rot) * outerRadius;
      y = cy + Math.sin(rot) * outerRadius;
      ctx.lineTo(x, y);
      rot += step;

      x = cx + Math.cos(rot) * innerRadius;
      y = cy + Math.sin(rot) * innerRadius;
      ctx.lineTo(x, y);
      rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
  }

  function drawRectangularComparativeScreen(ctx, w, h, players, sumCurrent) {
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;

    // 1. Set Rounded Rectangle Clip on Canvas
    const cornerR = 20;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cornerR, 0);
    ctx.lineTo(w - cornerR, 0);
    ctx.quadraticCurveTo(w, 0, w, cornerR);
    ctx.lineTo(w, h - cornerR);
    ctx.quadraticCurveTo(w, h, w - cornerR, h);
    ctx.lineTo(cornerR, h);
    ctx.quadraticCurveTo(0, h, 0, h - cornerR);
    ctx.lineTo(0, cornerR);
    ctx.quadraticCurveTo(0, 0, cornerR, 0);
    ctx.closePath();
    ctx.clip();

    // Dark stage background base
    ctx.fillStyle = '#08090e';
    ctx.fillRect(0, 0, w, h);

    // If NO real players have bid yet:
    if (!players || players.length === 0) {
      ctx.save();
      const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 260);
      grad.addColorStop(0, 'rgba(14, 165, 233, 0.25)');
      grad.addColorStop(1, '#08090e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Glowing Center Icon
      ctx.beginPath();
      ctx.arc(cx, cy - 20, 36, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14, 165, 233, 0.15)';
      ctx.strokeStyle = '#0ea5e9';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#0ea5e9';
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 15px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("HOZIRCHA STAVKALAR YO'Q", cx, cy + 36);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText("Birinchi bo'lib stavka qo'ying va sloti egallang!", cx, cy + 56);
      ctx.restore();
      ctx.restore();
      return;
    }

    // 2. Draw Real Players' Sections (100% Rectangle Coverage - No Empty Gaps!)
    if (players.length === 1) {
      const p = players[0];
      const color = WHEEL_COLORS[0];

      ctx.save();
      const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h));
      grad.addColorStop(0, '#111422');
      grad.addColorStop(0.4, color + '55');
      grad.addColorStop(1, color + 'dd');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Glowing avatar in center
      const avSize = 58;
      ctx.beginPath();
      ctx.arc(cx, cy - 10, avSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const img = getAvatarImage(p.user_avatar);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, cx - avSize / 2, cy - 10 - avSize / 2, avSize, avSize);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((p.user_name || 'P').slice(0, 1).toUpperCase(), cx, cy - 10);
      }
      ctx.restore();

      // Glowing border
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy - 10, avSize / 2, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffd700';
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 14;
      ctx.stroke();

      // Crown
      ctx.fillStyle = '#ffd700';
      const cw = 20, ch = 11;
      const crx = cx - cw / 2, cry = cy - 10 - avSize / 2 - 14;
      ctx.beginPath();
      ctx.moveTo(crx, cry + ch);
      ctx.lineTo(crx + cw, cry + ch);
      ctx.lineTo(crx + cw, cry);
      ctx.lineTo(crx + cw * 0.75, cry + ch * 0.5);
      ctx.lineTo(crx + cw * 0.5, cry);
      ctx.lineTo(crx + cw * 0.25, cry + ch * 0.5);
      ctx.lineTo(crx, cry);
      ctx.closePath();
      ctx.fill();

      // Name & Amount
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(p.user_name || 'Player').toUpperCase(), cx, cy + 34);

      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.fillText(formatMoney(p.total_bid), cx, cy + 52);
      ctx.restore();

      ctx.restore();
      return;
    }

    // MULTIPLE REAL PLAYERS: Normalize to 100% (2 * PI) so entire rectangle is filled!
    let startAngle = -Math.PI / 2; // Start from top 12 o'clock
    const now = Date.now();

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      // Normalize proportion to 100% of 2*PI
      const normPct = (sumCurrent > 0) ? (p.currentPct / sumCurrent) : (1 / players.length);
      const sliceAngle = normPct * (Math.PI * 2);
      const endAngle = startAngle + sliceAngle;
      const midAngle = startAngle + sliceAngle / 2;
      const color = WHEEL_COLORS[i % WHEEL_COLORS.length];
      const isLeader = (i === 0);
      const isNewBurst = (lastNewBidTelegramId === p.telegram_id && (now - newBidBurstTime < 1800));

      // Build Polygon from (cx, cy) along rectangle perimeter
      const steps = Math.max(16, Math.round(sliceAngle * 16));
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);

      for (let s = 0; s <= steps; s++) {
        const a = startAngle + (sliceAngle * s / steps);
        const pt = getRayRectIntersection(cx, cy, w, h, a);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      // Saturated Vibrant Gradient Fill
      const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, Math.max(w, h) * 0.85);
      grad.addColorStop(0, '#111422');
      grad.addColorStop(0.35, color + (isNewBurst ? '88' : '55'));
      grad.addColorStop(1, color + (isNewBurst ? 'ff' : 'dd'));
      ctx.fillStyle = grad;
      ctx.fill();

      // Neon Divider Border
      ctx.lineWidth = isNewBurst ? 4.5 : 2.8;
      ctx.strokeStyle = isNewBurst ? '#ffffff' : color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isNewBurst ? 18 : 10;
      ctx.stroke();
      ctx.restore();

      // Outer Edge Tag (P1, P2...)
      const edgePt = getRayRectIntersection(cx, cy, w, h, midAngle);
      const distEdge = Math.hypot(edgePt.x - cx, edgePt.y - cy);
      const tagDist = distEdge - 22;
      const tx = cx + Math.cos(midAngle) * tagDist;
      const ty = cy + Math.sin(midAngle) * tagDist;

      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(`P${i + 1}`, tx, ty);
      ctx.restore();

      // Circular Photo Avatar in Center of Zone
      const avDist = distEdge * 0.56;
      const ax = cx + Math.cos(midAngle) * avDist;
      const ay = cy + Math.sin(midAngle) * avDist;
      const avSize = Math.min(52, Math.max(34, distEdge * sliceAngle * 0.32));

      ctx.save();
      ctx.beginPath();
      ctx.arc(ax, ay, avSize / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      const img = getAvatarImage(p.user_avatar);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, ax - avSize / 2, ay - avSize / 2, avSize, avSize);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${Math.round(avSize * 0.45)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((p.user_name || 'P').slice(0, 1).toUpperCase(), ax, ay);
      }
      ctx.restore();

      // Glowing Avatar Border
      ctx.save();
      ctx.beginPath();
      ctx.arc(ax, ay, avSize / 2, 0, Math.PI * 2);
      ctx.lineWidth = isLeader ? 3.5 : 2;
      ctx.strokeStyle = isLeader ? '#ffd700' : '#ffffff';
      ctx.shadowColor = isLeader ? '#ffd700' : color;
      ctx.shadowBlur = isLeader ? 14 : 8;
      ctx.stroke();
      ctx.restore();

      // Vector Golden Crown on Leader Avatar
      if (isLeader) {
        ctx.save();
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 10;
        const cw = 18, ch = 10;
        const crx = ax - cw / 2, cry = ay - avSize / 2 - 12;
        ctx.beginPath();
        ctx.moveTo(crx, cry + ch);
        ctx.lineTo(crx + cw, cry + ch);
        ctx.lineTo(crx + cw, cry);
        ctx.lineTo(crx + cw * 0.75, cry + ch * 0.5);
        ctx.lineTo(crx + cw * 0.5, cry);
        ctx.lineTo(crx + cw * 0.25, cry + ch * 0.5);
        ctx.lineTo(crx, cry);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Player Name & Real Amount in UZS (Upright under avatar)
      if (sliceAngle > 0.25) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.95)';
        ctx.shadowBlur = 6;
        const nameY = ay + avSize / 2 + 4;
        if (nameY + 22 < h) {
          ctx.fillText((p.user_name || 'Player').slice(0, 10).toUpperCase(), ax, nameY);
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 11px Inter, sans-serif';
          ctx.fillText(formatMoney(p.total_bid), ax, nameY + 13);
        }
        ctx.restore();
      }

      // Vector Golden Star Token on Leader Slice
      if (isLeader) {
        const starDist = distEdge - 30;
        const sx = cx + Math.cos(midAngle) * starDist;
        const sy = cy + Math.sin(midAngle) * starDist;
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.fillStyle = '#0a0d18';
        drawVectorStar(ctx, sx, sy, 5, 7, 3.5);
        ctx.restore();
      }

      startAngle = endAngle;
    }

    // 3. Center Hub Neon Dot
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.restore();

    ctx.restore();
  }
  // =========================================================================
  // 5. HOME PAGE BANNER TO AUCTION
  // =========================================================================
  function checkAndInjectHomeBanner() {
    const isHome = window.location.pathname === '/' || window.location.pathname === '';
    if (!isHome) {
      const banner = document.getElementById('topsxema-home-auction-banner');
      if (banner) banner.remove();
      return;
    }

    if (document.getElementById('topsxema-home-auction-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'topsxema-home-auction-banner';
    banner.style.cssText = `
      margin: 12px 16px;
      background: linear-gradient(135deg, rgba(20, 24, 38, 0.95), rgba(15, 17, 26, 0.95));
      border: 1.5px solid rgba(14, 165, 233, 0.4);
      border-radius: 18px;
      padding: 14px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(14, 165, 233, 0.15);
      transition: transform 0.2s;
    `;

    banner.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; min-width:0;">
        <div style="width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg, rgba(14,165,233,0.25), rgba(139,92,246,0.25)); display:flex; align-items:center; justify-content:center; color:#38bdf8; flex-shrink:0;">
          ${ICONS.trophy}
        </div>
        <div style="min-width:0;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:13.5px; font-weight:800; color:#fff;">Instagram Collab Auksioni</span>
            <span style="font-size:9.5px; font-weight:800; background:#0ea5e9; color:#fff; padding:1px 6px; border-radius:6px;">Yangi</span>
          </div>
          <div style="font-size:11.5px; color:#94a3b8; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            1M+ obunachili akkauntda hammualliflik sloti
          </div>
        </div>
      </div>
      <div style="color:#38bdf8;">${ICONS.chevron}</div>
    `;

    banner.onclick = () => {
      const mktLink = document.querySelector('a[href*="/marketplace"]');
      if (mktLink) {
        mktLink.click();
      } else {
        window.location.href = '/marketplace';
      }
      activeTab = 'auction';
      setTimeout(() => switchMarketplaceTab('auction'), 300);
    };

    const main = document.querySelector('main') || document.body;
    main.insertBefore(banner, main.firstChild);
  }

  // =========================================================================
  // INITIALIZATION LOOP & ROUTE CHANGE LISTENER
  // =========================================================================
  function tick() {
    // Har bir qadam alohida himoyalangan: bitta xato qolganlarini o'ldirmasin.
    const steps = [
      handleDeepLink,
      checkAndInjectLiveBudget,
      checkAndInjectProfileAdminCard,
      enhanceMarketplaceWithAuction,
      checkAndInjectHomeBanner,
      checkAndInjectAdminFab,
      syncDockOffset
    ];
    for (const fn of steps) {
      try {
        fn();
      } catch (e) {
        console.warn('tick step failed:', fn.name, e);
      }
    }
  }

  function detectRouteChange() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      window.scrollTo(0, 0);
      tick();
    }
  }

  const origPushState = history.pushState;
  history.pushState = function() {
    origPushState.apply(this, arguments);
    setTimeout(detectRouteChange, 20);
    setTimeout(detectRouteChange, 100);
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function() {
    origReplaceState.apply(this, arguments);
    setTimeout(detectRouteChange, 20);
    setTimeout(detectRouteChange, 100);
  };
  window.addEventListener('popstate', () => {
    setTimeout(detectRouteChange, 20);
  });

  // Bitta marta ishga tushirish (oldingi kod ikki marta interval ochardi)
  let appStarted = false;
  function startApp() {
    if (appStarted) return;
    appStarted = true;
    initTelegram();
    syncServerTime();
    loadSettings();
    tick();
    setInterval(tick, 500);
    setInterval(loadSettings, 5000);
    setInterval(syncServerTime, 60000);
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startApp, { once: true });
  } else {
    startApp();
  }


/* ================================================================
   PATCH v3.9 — Player list redesign + User auction nav + Share btn
   ================================================================ */
(function patchV39() {
  'use strict';

  var WEBAPP = 'https://topsxema.duckdns.org';
  var BOT_URL = 'https://t.me/topsxema_bot';

  /* ---- User Auction FAB on non-marketplace pages ---- */
  function checkUserAuctionFab() {
    var isMarketplace = window.location.pathname.indexOf('/marketplace') !== -1;
    if (isMarketplace) {
      document.body.classList.add('on-marketplace');
      var ef = document.getElementById('topsxema-user-auction-fab');
      if (ef) ef.remove();
      return;
    }
    document.body.classList.remove('on-marketplace');
    if (document.getElementById('topsxema-user-auction-fab')) return;
    var fab = document.createElement('button');
    fab.id = 'topsxema-user-auction-fab';
    fab.setAttribute('aria-label', "Auksionga o'tish");
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg> Auksion';
    fab.onclick = function() {
      window.location.href = WEBAPP + '/marketplace?tab=auction';
    };
    document.body.appendChild(fab);
  }

  /* ---- Admin nav indicator fix ---- */
  function fixAdminNavIndicator() {
    var pill = document.getElementById('admin-nav-pill');
    if (!pill) return;
    var items = pill.querySelectorAll('.topsxema-admin-nav-item');
    var n = items.length || 4;
    pill.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
    var ind = document.getElementById('admin-nav-indicator');
    if (!ind) return;
    var active = pill.querySelector('.topsxema-admin-nav-item.active') || items[0];
    var idx = Array.from(items).indexOf(active);
    ind.style.width = 'calc((100% - 8px) / ' + n + ')';
    ind.style.translate = (Math.max(0, idx) * 100) + '% 0';
  }

  /* ---- Player cards beautify ---- */
  function beautifyPlayerCards() {
    var cards = document.querySelectorAll('.portals-player-card:not([data-v39])');
    cards.forEach(function(card, idx) {
      card.setAttribute('data-v39', '1');
      var main = card.querySelector('.portals-player-card-main');
      if (!main) return;

      // Add rank badge
      if (!main.querySelector('.portals-player-rank-badge')) {
        var badge = document.createElement('div');
        badge.className = 'portals-player-rank-badge' +
          (idx === 0 ? ' is-gold' : idx === 1 ? ' is-silver' : idx === 2 ? ' is-bronze' : '');
        badge.textContent = idx === 0 ? '\u{1F947}' : idx === 1 ? '\u{1F948}' : idx === 2 ? '\u{1F949}' : '#' + (idx + 1);
        main.insertBefore(badge, main.firstChild);
      }

      if (idx === 0) card.classList.add('is-leader');

      // Add progress bar
      if (!card.querySelector('.portals-player-progress-wrap')) {
        var dotEl = card.querySelector('.portals-player-dot');
        var color = dotEl ? (dotEl.style.background || '#38bdf8') : '#38bdf8';
        var chancePctEl = card.querySelector('.portals-player-chance-row span:last-child');
        var pctVal = chancePctEl ? parseFloat(chancePctEl.textContent) : 0;
        var wrap = document.createElement('div');
        wrap.className = 'portals-player-progress-wrap';
        var fill = document.createElement('div');
        fill.className = 'portals-player-progress-fill';
        fill.style.width = Math.min(100, Math.max(2, pctVal)) + '%';
        fill.style.background = color;
        wrap.appendChild(fill);
        card.appendChild(wrap);
      }
    });
  }

  /* ---- Account share buttons in marketplace ---- */
  function injectShareButtons() {
    if (window.location.pathname.indexOf('/marketplace') === -1) return;
    // Target account cards — try common selectors
    var cards = document.querySelectorAll('[data-account-id]:not([data-share-btn]), [data-id]:not([data-share-btn])');
    cards.forEach(function(card) {
      var accId = card.dataset.accountId || card.dataset.id;
      if (!accId || isNaN(Number(accId))) return;
      card.setAttribute('data-share-btn', '1');
      var btn = document.createElement('button');
      btn.className = 'topsxema-account-share-btn';
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Ulashish';
      btn.onclick = function(e) {
        e.stopPropagation();
        var shareLink = BOT_URL + '?start=acc_' + accId;
        var shareText = "Instagram akkauntini ko'ring!";
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.openTelegramLink) {
          window.Telegram.WebApp.openTelegramLink(
            'https://t.me/share/url?url=' + encodeURIComponent(shareLink) +
            '&text=' + encodeURIComponent(shareText)
          );
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(shareLink).then(function() {
            btn.innerHTML = '\u2705 Nusxalandi!';
            setTimeout(function() {
              btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg> Ulashish';
            }, 1800);
          });
        }
      };
      // Append into card
      var actionArea = card.querySelector('button:last-of-type');
      if (actionArea && actionArea.parentElement && actionArea !== btn) {
        actionArea.parentElement.insertBefore(btn, actionArea.nextSibling);
      } else {
        card.appendChild(btn);
      }
    });
  }

  /* ---- Main tick ---- */
  var lastPathV39 = window.location.pathname;
  function tick39() {
    var curPath = window.location.pathname;
    if (curPath !== lastPathV39) {
      lastPathV39 = curPath;
      checkUserAuctionFab();
    }
    if (document.getElementById('admin-nav-pill')) {
      fixAdminNavIndicator();
    }
    beautifyPlayerCards();
    injectShareButtons();
  }

  function init39() {
    checkUserAuctionFab();
    setInterval(tick39, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(init39, 300); });
  } else {
    setTimeout(init39, 300);
  }
})();


/* ================================================================
   PATCH v4.0 — renderPlayersList Soqaliy-style rewrite
   ================================================================ */
(function patchArenaV40() {
  'use strict';

  var WCOLORS = [
    '#00e5ff','#ff7a00','#ff2d87','#8b5cf6',
    '#10b981','#d946ef','#f59e0b','#3b82f6',
    '#ec4899','#14b8a6'
  ];

  function fmtUZS(val) {
    var n = Number(val) || 0;
    if (n >= 1000000) return (n/1000000).toFixed(n%1000000===0?0:1) + ' mln';
    if (n >= 1000) return (n/1000).toFixed(n%1000===0?0:0) + ' ming';
    return n.toLocaleString('uz-UZ');
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* Patch renderPlayersList by overriding the DOM output after render */
  function rebuildPlayerCards() {
    var arena = document.getElementById('portal-arena-wrapper');
    if (!arena) return;

    /* Find all existing player cards and rebuild them */
    var cards = arena.querySelectorAll('.portals-player-card:not([data-v40])');
    if (!cards.length) return;

    cards.forEach(function(card, idx) {
      /* Extract data from existing elements */
      var nameEl = card.querySelector('.portals-player-name');
      var dotEl  = card.querySelector('.portals-player-dot');
      var pctEl  = card.querySelector('.portals-player-chance-row span:last-child');
      var bidEl  = card.querySelector('.portals-player-bid');
      var imgEl  = card.querySelector('.portals-player-avatar img');
      var avatarEl = card.querySelector('.portals-player-avatar');

      var name   = nameEl  ? nameEl.textContent.trim()  : 'Player';
      var color  = dotEl   ? dotEl.style.background     : (WCOLORS[idx % WCOLORS.length]);
      var pct    = pctEl   ? pctEl.textContent.trim()   : '0%';
      var bid    = bidEl   ? bidEl.textContent.trim()   : '';
      var imgSrc = imgEl   ? imgEl.src                  : '';
      var initLetter = name.slice(0,1).toUpperCase();

      /* Parse bid value — strip spaces, UZS, commas */
      var bidNum = parseInt(String(bid).replace(/[^0-9]/g,''), 10) || 0;
      var bidDisplay = fmtUZS(bidNum);

      /* Rank symbols */
      var ranks = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'];
      var rankHtml = idx < 3
        ? '<span class="ppc-rank">' + ranks[idx] + '</span>'
        : '<span class="ppc-rank" style="font-size:11px;color:#475569;">#' + (idx+1) + '</span>';

      /* Avatar */
      var avatarBg = imgSrc ? 'transparent' : color;
      var avatarContent = imgSrc
        ? '<img src="' + escHtml(imgSrc) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">'
        : initLetter;
      var crownHtml = idx === 0
        ? '<span class="ppc-avatar-crown">\uD83D\uDC51</span>'
        : '';

      /* Build new inner HTML */
      var pctVal = parseFloat(pct) || 0;
      card.setAttribute('data-v40','1');
      card.setAttribute('data-rank', String(idx));
      card.innerHTML =
        '<div class="portals-player-card-main">'
        + rankHtml
        + '<div class="ppc-avatar" style="background:' + avatarBg + ';border-color:' + color + '40;">'
          + crownHtml
          + avatarContent
        + '</div>'
        + '<div class="ppc-info">'
          + '<div class="ppc-name">' + escHtml(name) + '</div>'
          + '<div class="ppc-pct-row">'
            + '<span class="ppc-dot" style="background:' + color + ';"></span>'
            + '<span class="ppc-pct-text">' + escHtml(pct) + '</span>'
          + '</div>'
        + '</div>'
        + '<div class="ppc-amount">'
          + '<span class="ppc-amount-val">' + bidDisplay + '</span>'
          + '<span class="ppc-amount-cur">UZS</span>'
        + '</div>'
        + '</div>'
        + '<div class="ppc-bar"><div class="ppc-bar-fill" style="width:' + Math.min(100, Math.max(2, pctVal)) + '%;background:' + color + ';"></div></div>';
    });
  }

  /* Run periodically after auction arena renders */
  var _lastCardCount = 0;
  function tickArena() {
    var cards = document.querySelectorAll('.portals-player-card');
    if (cards.length !== _lastCardCount || document.querySelector('.portals-player-card:not([data-v40])')) {
      _lastCardCount = cards.length;
      rebuildPlayerCards();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setInterval(tickArena, 500); });
  } else {
    setInterval(tickArena, 500);
  }
})();

})();
