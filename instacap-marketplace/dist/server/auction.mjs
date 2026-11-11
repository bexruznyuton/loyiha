// Auksion moduli — Instagram akkauntlarini auksion orqali sotish.
// node-build.mjs ichidagi createServer() dan registerAuction(app, deps) chaqiriladi.

const STEP_FIXED = 7000;       // minimal qadam: har bir stavka kamida 7 000 so'm oshadi
const SNIPE_MS = 40 * 1000; // oxirgi 40 soniyada stavka -> auksion vaqtiga +40 soniya
const TRANSFER_HOURS = 48;     // g'olib aniqlangach sotuvchi shu vaqt ichida topshiradi
const CONFIRM_HOURS = 24;      // topshirilgach xaridor shu vaqtda tasdiqlamasa avto-yakun
const DURATIONS = [24, 72, 168];
const MIN_START = 10000;
const MAX_PRICE = 1000000000;

let D = null; // deps

const fmt = (n) => Number(n || 0).toLocaleString('ru-RU').replace(/,/g, ' ') + " so'm";
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const stepFor = () => STEP_FIXED;
const lotName = (a) => (/^lot_/.test(a?.ig_username || '') ? 'Lot #' + a.id : '@' + esc(a?.ig_username));

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function isAdmin(u) {
  return !!u && (u.role === 'ADMIN' || adminIds().includes(String(u.telegramId)));
}
async function notifyUser(userId, text) {
  try {
    const u = await D.prisma.user.findUnique({ where: { id: userId } });
    if (u) await D.sendBotMessage(String(u.telegramId), text, { parse_mode: 'HTML', disable_web_page_preview: true });
  } catch (e) { console.warn('[auction] notify failed', e?.message || e); }
}
async function notifyAdmins(text) {
  for (const id of adminIds()) {
    try { await D.sendBotMessage(id, text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
  }
}

async function migrate() {
  const p = D.prisma;
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    seller_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ig_username TEXT NOT NULL,
    followers INT NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    photo_file_id TEXT NOT NULL DEFAULT '',
    start_price INT NOT NULL,
    current_price INT NOT NULL,
    leader_id INT NULL,
    bids_count INT NOT NULL DEFAULT 0,
    duration_hours INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    starts_at TIMESTAMPTZ NULL,
    ends_at TIMESTAMPTZ NULL,
    won_at TIMESTAMPTZ NULL,
    transfer_info TEXT NOT NULL DEFAULT '',
    transferred_at TIMESTAMPTZ NULL,
    reject_reason TEXT NOT NULL DEFAULT '',
    dispute_reason TEXT NOT NULL DEFAULT '',
    commission_rate INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS auctions_status_ends_idx ON auctions(status, ends_at)`);
  await p.$executeRawUnsafe(`ALTER TABLE auctions ADD COLUMN IF NOT EXISTS post_url TEXT NOT NULL DEFAULT ''`);
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS auction_bids (
    id SERIAL PRIMARY KEY,
    auction_id INT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INT NOT NULL,
    deposit_used INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'HELD',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS auction_bids_auction_idx ON auction_bids(auction_id, amount DESC)`);
  await p.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS auction_bids_user_idx ON auction_bids(user_id)`);
}

// ---------- Hamyon amallari (tx ichida) ----------
async function ensureWallet(tx, userId) {
  return tx.wallet.upsert({ where: { userId }, update: {}, create: { userId } });
}
async function holdFunds(tx, userId, amount, auctionId) {
  const w = await ensureWallet(tx, userId);
  const claimed = await tx.wallet.updateMany({
    where: { userId, balance: { gte: amount } },
    data: { balance: { decrement: amount }, frozenBalance: { increment: amount } },
  });
  if (claimed.count === 0) throw new Error('INSUFFICIENT_BALANCE');
  const fresh = await tx.wallet.findUnique({ where: { userId } });
  const dep = Math.max(0, Math.min(fresh.depositBalance, amount));
  if (dep > 0) await tx.wallet.update({ where: { userId }, data: { depositBalance: { decrement: dep } } });
  await tx.transaction.create({
    data: { walletId: w.id, type: 'ESCROW_HOLD', amount: -amount, status: 'COMPLETED', note: `Auksion #${auctionId}: stavka muzlatildi`, meta: { auctionId } },
  });
  return dep;
}
async function refundBid(tx, bid, note) {
  const w = await ensureWallet(tx, bid.user_id);
  await tx.wallet.update({
    where: { userId: bid.user_id },
    data: {
      balance: { increment: bid.amount },
      frozenBalance: { decrement: bid.amount },
      depositBalance: { increment: bid.deposit_used || 0 },
    },
  });
  await tx.transaction.create({
    data: { walletId: w.id, type: 'ESCROW_REFUND', amount: bid.amount, status: 'COMPLETED', note: note || `Auksion #${bid.auction_id}: stavka qaytarildi`, meta: { auctionId: bid.auction_id } },
  });
  await tx.$executeRawUnsafe(`UPDATE auction_bids SET status='REFUNDED' WHERE id=$1`, bid.id);
}
async function releaseToSeller(tx, a, bid) {
  const rate = a.commission_rate || 0;
  const commission = Math.round((bid.amount * rate) / 100);
  const net = bid.amount - commission;
  await tx.wallet.update({
    where: { userId: bid.user_id },
    data: { frozenBalance: { decrement: bid.amount }, totalSpent: { increment: bid.amount } },
  });
  const sw = await ensureWallet(tx, a.seller_id);
  await tx.wallet.update({ where: { userId: a.seller_id }, data: { balance: { increment: net }, totalEarned: { increment: net } } });
  await tx.transaction.create({
    data: { walletId: sw.id, type: 'ESCROW_RELEASE', amount: net, status: 'COMPLETED', note: `Auksion #${a.id}: @${a.ig_username} sotildi (komissiya ${rate}%: ${commission})`, meta: { auctionId: a.id, commission } },
  });
  await tx.$executeRawUnsafe(`UPDATE auction_bids SET status='RELEASED' WHERE id=$1`, bid.id);
  return { net, commission };
}
async function lockAuction(tx, id) {
  const rows = await tx.$queryRawUnsafe(`SELECT * FROM auctions WHERE id=$1 FOR UPDATE`, id);
  return rows[0] || null;
}
async function topBid(tx, auctionId, statuses = ['HELD', 'WON']) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT * FROM auction_bids WHERE auction_id=$1 AND status = ANY($2::text[]) ORDER BY amount DESC, id ASC LIMIT 1`,
    auctionId, statuses,
  );
  return rows[0] || null;
}
const TX = { timeout: 20000, maxWait: 10000 };

// ---------- Serializatsiya ----------
function photoUrl(fid) { if (!fid) return ''; if (fid.startsWith('img:')) return '/auc-img/' + fid.slice(4); return `/api/files/${encodeURIComponent(fid)}`; }
function photoList(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean).map(photoUrl); }
function pub(a, me, extra = {}) {
  const minNext = a.bids_count > 0 ? a.current_price + stepFor(a.current_price) : a.start_price;
  return {
    id: a.id,
    igUsername: a.ig_username,
    followers: a.followers,
    category: a.category,
    description: a.description,
    photoUrl: photoList(a.photo_file_id)[0] || '',
    photos: photoList(a.photo_file_id),
    startPrice: a.start_price,
    currentPrice: a.current_price,
    minNext,
    step: stepFor(a.current_price),
    bidsCount: a.bids_count,
    durationHours: a.duration_hours,
    status: a.status,
    startsAt: a.starts_at,
    endsAt: a.ends_at,
    isMine: !!me && a.seller_id === me.id,
    iAmLeader: !!me && a.leader_id === me.id,
    rejectReason: a.seller_id === me?.id ? a.reject_reason : '',
    postUrl: a.post_url || '',
    createdAt: a.created_at,
    ...extra,
  };
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      const m = e?.message || String(e);
      const map = {
        INSUFFICIENT_BALANCE: [400, "Balansingizda mablag' yetarli emas. Avval hamyonni to'ldiring."],
        NOT_FOUND: [404, 'Auksion topilmadi'],
      };
      if (map[m]) return res.status(map[m][0]).json({ success: false, code: m, error: map[m][1] });
      if (m.startsWith('USER:')) return res.status(400).json({ success: false, error: m.slice(5) });
      console.error('[auction] error', e);
      res.status(500).json({ success: false, error: 'Server xatosi' });
    }
  };
}
const uerr = (msg) => new Error('USER:' + msg);

// ---------- Handlerlar ----------
async function hMe(req, res) {
  const w = await D.prisma.wallet.findUnique({ where: { userId: req.pgUser.id } });
  res.json({ success: true, isAdmin: isAdmin(req.pgUser), balance: w?.balance || 0, frozen: w?.frozenBalance || 0 });
}

async function hList(req, res) {
  const me = req.pgUser;
  const tab = String(req.query.tab || 'active');
  let rows;
  if (tab === 'ended') {
    rows = await D.prisma.$queryRawUnsafe(
      `SELECT * FROM auctions WHERE status IN ('AWAITING_TRANSFER','TRANSFERRED','COMPLETED','DISPUTED','ENDED_NO_BIDS') AND ends_at > now() - interval '7 days' ORDER BY ends_at DESC LIMIT 60`);
  } else {
    rows = await D.prisma.$queryRawUnsafe(`SELECT * FROM auctions WHERE status='ACTIVE' ORDER BY ends_at ASC LIMIT 200`);
  }
  let myBids = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const mb = await D.prisma.$queryRawUnsafe(
      `SELECT auction_id, MAX(amount)::int AS amount FROM auction_bids WHERE user_id=$1 AND auction_id = ANY($2::int[]) GROUP BY auction_id`, me.id, ids);
    for (const b of mb) myBids[b.auction_id] = b.amount;
  }
  res.json({ success: true, serverTime: new Date().toISOString(), items: rows.map((a) => pub(a, me, { myBid: myBids[a.id] || 0 })) });
}

async function hGet(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  const rows = await D.prisma.$queryRawUnsafe(`SELECT * FROM auctions WHERE id=$1`, id);
  const a = rows[0];
  if (!a) throw new Error('NOT_FOUND');
  const admin = isAdmin(me);
  if (!a.photo_file_id && a.status === 'ACTIVE') fillProfile(a.id, a.ig_username);
  if (a.status === 'PENDING' || a.status === 'REJECTED' || a.status === 'CANCELLED' || a.status === 'DELETED') {
    if (a.seller_id !== me.id && !admin) throw new Error('NOT_FOUND');
  }
  const bids = await D.prisma.$queryRawUnsafe(
    `SELECT b.id, b.user_id, b.amount, b.created_at, u.first_name, u.username, u.photo_url FROM auction_bids b JOIN users u ON u.id=b.user_id WHERE b.auction_id=$1 ORDER BY b.created_at DESC, b.id DESC LIMIT 300`, id);
  bids.reverse();
  const nameOf = (b) => (b.username ? '@' + b.username : (b.first_name || 'Foydalanuvchi'));
  const safePhoto = (u) => (/^https:\/\//.test(u || '') ? u : '');
  const lmap = new Map();
  for (const b of bids) {
    const L = lmap.get(b.user_id) || { userId: b.user_id, amount: 0, count: 0, name: nameOf(b), firstName: b.first_name || '', photo: safePhoto(b.photo_url), last: b.created_at };
    L.amount = Math.max(L.amount, b.amount); L.count += 1; L.last = b.created_at;
    lmap.set(b.user_id, L);
  }
  const leaders = [...lmap.values()].sort((x, y) => y.amount - x.amount || new Date(x.last) - new Date(y.last)).slice(0, 10)
    .map((L) => ({ amount: L.amount, count: L.count, name: L.name, firstName: L.firstName, photo: L.photo, isMe: L.userId === me.id, isLeader: L.userId === a.leader_id }));
  const isWinner = a.leader_id === me.id && ['AWAITING_TRANSFER', 'TRANSFERRED', 'COMPLETED', 'DISPUTED', 'REFUNDED'].includes(a.status);
  const myBidRow = await D.prisma.$queryRawUnsafe(`SELECT MAX(amount)::int AS amount FROM auction_bids WHERE auction_id=$1 AND user_id=$2`, id, me.id);
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    item: pub(a, me, {
      myBid: myBidRow[0]?.amount || 0,
      isWinner,
      transferInfo: (isWinner || a.seller_id === me.id || admin) ? a.transfer_info : '',
      transferredAt: a.transferred_at,
      wonAt: a.won_at,
      disputeReason: (isWinner || a.seller_id === me.id || admin) ? a.dispute_reason : '',
      transferDeadline: a.won_at ? new Date(new Date(a.won_at).getTime() + TRANSFER_HOURS * 3600e3).toISOString() : null,
      confirmDeadline: a.transferred_at ? new Date(new Date(a.transferred_at).getTime() + CONFIRM_HOURS * 3600e3).toISOString() : null,
      commissionRate: a.seller_id === me.id || admin ? a.commission_rate : undefined,
    }),
    leaders,
    timeline: bids.map((b) => ({ amount: b.amount, at: b.created_at })),
    bids: bids.slice().reverse().slice(0, 15).map((b) => ({
      id: b.id,
      amount: b.amount,
      createdAt: b.created_at,
      isMe: b.user_id === me.id,
      name: b.user_id === me.id ? 'Siz' : nameOf(b),
      photo: safePhoto(b.photo_url),
    })),
  });
}

async function hMy(req, res) {
  const me = req.pgUser;
  const selling = await D.prisma.$queryRawUnsafe(`SELECT * FROM auctions WHERE seller_id=$1 ORDER BY created_at DESC LIMIT 100`, me.id);
  const bidding = await D.prisma.$queryRawUnsafe(
    `SELECT a.*, x.my_bid FROM auctions a JOIN (SELECT auction_id, MAX(amount)::int AS my_bid FROM auction_bids WHERE user_id=$1 GROUP BY auction_id) x ON x.auction_id=a.id ORDER BY a.updated_at DESC LIMIT 100`, me.id);
  res.json({
    success: true,
    serverTime: new Date().toISOString(),
    selling: selling.map((a) => pub(a, me)),
    bidding: bidding.map((a) => pub(a, me, { myBid: a.my_bid, isWinner: a.leader_id === me.id && a.status !== 'ACTIVE' })),
  });
}

async function hCreate(req, res) {
  const me = req.pgUser;
  if (!isAdmin(me)) return res.status(403).json({ success: false, error: "Auksionga faqat admin lot qo'sha oladi" });
  const b = req.body || {};
  const ig = String(b.igUsername || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^[a-z0-9._]{2,30}$/.test(ig)) throw uerr("Instagram username noto'g'ri");
  const followers = Math.max(0, Math.min(1e9, parseInt(b.followers, 10) || 0));
  const startPrice = parseInt(b.startPrice, 10) || 0;
  if (startPrice < MIN_START) throw uerr(`Boshlang'ich narx kamida ${fmt(MIN_START)} bo'lishi kerak`);
  if (startPrice > MAX_PRICE) throw uerr('Narx juda katta');
  let dur = parseInt(b.durationHours, 10);
  let endsAt = null;
  if (b.endsAt) {
    const d = new Date(b.endsAt);
    const diff = d.getTime() - Date.now();
    if (isNaN(diff) || diff < 10 * 60e3) throw uerr("Auksion tugash sanasi kamida 10 daqiqadan keyin bo'lishi kerak");
    if (diff > 60 * 86400e3) throw uerr("Auksion 60 kundan uzun bo'lishi mumkin emas");
    endsAt = d;
    dur = Math.max(1, Math.ceil(diff / 3600e3));
  } else if (!(Number.isInteger(dur) && dur >= 24 && dur <= 720 && dur % 24 === 0)) throw uerr("Auksion necha kun davom etishini tanlang");
  const category = String(b.category || '').slice(0, 60);
  const description = String(b.description || '').slice(0, 1500);
  const ids = (Array.isArray(b.photoFileIds) ? b.photoFileIds : [b.photoFileId])
    .map((x) => String(x || '').trim()).filter((x) => x && (/^img:[a-f0-9]{16,64}\.(jpg|png|webp)$/.test(x) || /^[A-Za-z0-9_\-]+$/.test(x))).slice(0, 3);
  const photo = ids.join(',');
  const act = await D.prisma.$queryRawUnsafe(`SELECT id FROM auctions WHERE status='ACTIVE' LIMIT 1`);
  if (act.length) throw uerr("Hozir faol auksion bor. Yangi auksion faqat u tugagandan keyin qo'shiladi.");
  const dup = await D.prisma.$queryRawUnsafe(`SELECT id FROM auctions WHERE ig_username=$1 AND status IN ('PENDING','ACTIVE','AWAITING_TRANSFER','TRANSFERRED','DISPUTED') LIMIT 1`, ig);
  if (dup.length) throw uerr('Bu akkaunt allaqachon auksionda');
  let postUrl = '';
  const pm = String(b.postUrl || '').trim().match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,64})\/(\d{1,9})/i);
  if (pm) postUrl = `https://t.me/${pm[1]}/${pm[2]}`;
  const rows = await D.prisma.$queryRawUnsafe(
    `INSERT INTO auctions (seller_id, ig_username, followers, category, description, photo_file_id, start_price, current_price, duration_hours, status, post_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,'PENDING',$9) RETURNING *`,
    me.id, ig, followers, category, description, photo, startPrice, dur, postUrl);
  // Admin qo'shgan lot darhol auksionga chiqadi
  const up = await D.prisma.$queryRawUnsafe(
    `UPDATE auctions SET status='ACTIVE', starts_at=now(), ends_at=COALESCE($3::timestamptz, now() + ($2 || ' hours')::interval), commission_rate=0, updated_at=now() WHERE id=$1 RETURNING *`,
    rows[0].id, String(dur), endsAt);
  const a = up[0];
  fillProfile(a.id, a.ig_username);
  res.json({ success: true, item: pub(a, me) });
}

async function hCancel(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  await D.prisma.$transaction(async (tx) => {
    const a = await lockAuction(tx, id);
    if (!a || a.seller_id !== me.id) throw new Error('NOT_FOUND');
    if (!(a.status === 'PENDING' || (a.status === 'ACTIVE' && a.bids_count === 0))) throw uerr("Stavka qo'yilgan lotni bekor qilib bo'lmaydi");
    await tx.$executeRawUnsafe(`UPDATE auctions SET status='CANCELLED', updated_at=now() WHERE id=$1`, id);
  }, TX);
  res.json({ success: true });
}

async function hBid(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  const amount = parseInt(req.body?.amount, 10) || 0;
  if (amount <= 0 || amount > MAX_PRICE) throw uerr("Summa noto'g'ri");
  let outbid = null, a2 = null;
  await D.prisma.$transaction(async (tx) => {
    const a = await lockAuction(tx, id);
    if (!a) throw new Error('NOT_FOUND');
    if (a.status !== 'ACTIVE' || new Date(a.ends_at) <= new Date()) throw uerr('Auksion tugagan');
    if (a.seller_id === me.id) throw uerr("O'z lotingizga stavka qo'yib bo'lmaydi");
    const minNext = a.bids_count > 0 ? a.current_price + stepFor(a.current_price) : a.start_price;
    if (amount < minNext) throw uerr(`Minimal stavka: ${fmt(minNext)}`);
    const prev = await topBid(tx, id, ['HELD']);
    let dep;
    if (prev && prev.user_id === me.id) {
      await refundBid(tx, prev, `Auksion #${id}: stavka oshirildi (eski qaytarildi)`);
      dep = await holdFunds(tx, me.id, amount, id);
    } else {
      dep = await holdFunds(tx, me.id, amount, id);
      if (prev) { await refundBid(tx, prev); outbid = prev; }
    }
    await tx.$executeRawUnsafe(`INSERT INTO auction_bids (auction_id, user_id, amount, deposit_used, status) VALUES ($1,$2,$3,$4,'HELD')`, id, me.id, amount, dep);
    const left = new Date(a.ends_at).getTime() - Date.now();
    const newEnd = left < SNIPE_MS ? new Date(new Date(a.ends_at).getTime() + SNIPE_MS) : new Date(a.ends_at);
    const up = await tx.$queryRawUnsafe(
      `UPDATE auctions SET current_price=$2, leader_id=$3, bids_count=bids_count+1, ends_at=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      id, amount, me.id, newEnd);
    a2 = up[0];
  }, TX);
  if (outbid && outbid.user_id !== me.id) {
    notifyUser(outbid.user_id, `⚠️ <b>Stavkangiz oshib ketildi</b>\n\n📸 ${lotName(a2)} — yangi narx: <b>${fmt(a2.current_price)}</b>\n💸 ${fmt(outbid.amount)} balansingizga qaytarildi.\n\nQayta stavka qo'yish uchun Auksion bo'limiga kiring.`);
  }
  notifyUser(a2.seller_id, `🔨 Lotingizga yangi stavka: ${lotName(a2)} — <b>${fmt(a2.current_price)}</b> (${a2.bids_count} ta stavka)`);
  res.json({ success: true, item: pub(a2, me, { myBid: amount }) });
}

async function hTransfer(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  const info = String(req.body?.info || '').trim().slice(0, 3000);
  if (info.length < 5) throw uerr("Topshirish ma'lumotlarini to'liq yozing");
  let a2;
  await D.prisma.$transaction(async (tx) => {
    const a = await lockAuction(tx, id);
    if (!a || a.seller_id !== me.id) throw new Error('NOT_FOUND');
    if (!['AWAITING_TRANSFER', 'TRANSFERRED'].includes(a.status)) throw uerr("Hozir topshirib bo'lmaydi");
    const up = await tx.$queryRawUnsafe(
      `UPDATE auctions SET transfer_info=$2, status='TRANSFERRED', transferred_at=COALESCE(transferred_at, now()), updated_at=now() WHERE id=$1 RETURNING *`, id, info);
    a2 = up[0];
  }, TX);
  notifyUser(a2.leader_id, `📦 <b>Sotuvchi akkauntni topshirdi</b>\n\n📸 ${lotName(a2)}\nKirish ma'lumotlari Mini App → Auksion → Mening auksionlarim bo'limida.\n\nTekshirib, <b>"Akkauntni oldim"</b> tugmasini bosing. Muammo bo'lsa — "Muammo bor". ${CONFIRM_HOURS} soat ichida javob bo'lmasa, pul sotuvchiga avtomatik o'tadi.`);
  res.json({ success: true });
}

async function hConfirm(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  let a, r;
  await D.prisma.$transaction(async (tx) => {
    a = await lockAuction(tx, id);
    if (!a || a.leader_id !== me.id) throw new Error('NOT_FOUND');
    if (!['TRANSFERRED', 'AWAITING_TRANSFER', 'DISPUTED'].includes(a.status)) throw uerr("Bu holatda tasdiqlab bo'lmaydi");
    const bid = await topBid(tx, id, ['WON']);
    if (!bid) throw uerr('Stavka topilmadi');
    r = await releaseToSeller(tx, a, bid);
    await tx.$executeRawUnsafe(`UPDATE auctions SET status='COMPLETED', updated_at=now() WHERE id=$1`, id);
  }, TX);
  notifyUser(a.seller_id, `✅ <b>Savdo yakunlandi!</b>\n\n📸 ${lotName(a)}\n💰 Balansingizga: <b>${fmt(r.net)}</b> (komissiya: ${fmt(r.commission)})`);
  res.json({ success: true });
}

async function hDispute(req, res) {
  const me = req.pgUser;
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1500);
  if (reason.length < 5) throw uerr('Muammoni batafsil yozing');
  let a;
  await D.prisma.$transaction(async (tx) => {
    a = await lockAuction(tx, id);
    if (!a || a.leader_id !== me.id) throw new Error('NOT_FOUND');
    if (!['TRANSFERRED', 'AWAITING_TRANSFER'].includes(a.status)) throw uerr("Bu holatda shikoyat qilib bo'lmaydi");
    await tx.$executeRawUnsafe(`UPDATE auctions SET status='DISPUTED', dispute_reason=$2, updated_at=now() WHERE id=$1`, id, reason);
  }, TX);
  notifyUser(a.seller_id, `⚠️ Xaridor ${lotName(a)} bo'yicha muammo bildirdi. Admin ko'rib chiqadi.`);
  notifyAdmins(`⚠️ <b>Auksion #${id} — nizo</b>\n📸 ${lotName(a)} · ${fmt(a.current_price)}\n\nSabab: ${esc(reason)}\n\nMini App → Auksion → Admin bo'limida hal qiling.`);
  res.json({ success: true });
}

// ---------- Admin ----------
async function hAdminList(req, res) {
  const me = req.pgUser;
  const rows = await D.prisma.$queryRawUnsafe(
    `SELECT a.*, u.first_name AS s_first, u.username AS s_username, u.telegram_id::text AS s_tg FROM auctions a JOIN users u ON u.id=a.seller_id
     WHERE a.status IN ('PENDING','DISPUTED','AWAITING_TRANSFER','TRANSFERRED') ORDER BY a.status, a.created_at ASC LIMIT 200`);
  res.json({
    success: true,
    items: rows.map((a) => pub(a, me, {
      seller: { firstName: a.s_first, username: a.s_username, telegramId: a.s_tg },
      transferInfo: a.transfer_info, disputeReason: a.dispute_reason, transferredAt: a.transferred_at, wonAt: a.won_at,
    })),
  });
}
async function hAdminApprove(req, res) {
  const id = Number(req.params.id);
  const rate = Math.round(Number(await D.getCommissionRate()) || 0);
  let a2;
  await D.prisma.$transaction(async (tx) => {
    const a = await lockAuction(tx, id);
    if (!a) throw new Error('NOT_FOUND');
    if (a.status !== 'PENDING') throw uerr('Lot tasdiqlash holatida emas');
    const up = await tx.$queryRawUnsafe(
      `UPDATE auctions SET status='ACTIVE', starts_at=now(), ends_at=now() + ($2 || ' hours')::interval, commission_rate=$3, updated_at=now() WHERE id=$1 RETURNING *`,
      id, String(a.duration_hours), rate);
    a2 = up[0];
  }, TX);
  notifyUser(a2.seller_id, `✅ <b>Auksion lotingiz tasdiqlandi!</b>\n\n📸 ${lotName(a2)}\n💰 Boshlang'ich narx: ${fmt(a2.start_price)}\n⏱ ${a2.duration_hours} soat davom etadi.`);
  res.json({ success: true });
}
async function hAdminReject(req, res) {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').slice(0, 500);
  let a;
  await D.prisma.$transaction(async (tx) => {
    a = await lockAuction(tx, id);
    if (!a) throw new Error('NOT_FOUND');
    if (a.status !== 'PENDING') throw uerr('Lot tasdiqlash holatida emas');
    await tx.$executeRawUnsafe(`UPDATE auctions SET status='REJECTED', reject_reason=$2, updated_at=now() WHERE id=$1`, id, reason);
  }, TX);
  notifyUser(a.seller_id, `❌ Auksion lotingiz (${lotName(a)}) rad etildi.${reason ? '\nSabab: ' + esc(reason) : ''}`);
  res.json({ success: true });
}
async function hAdminDelete(req, res) {
  const id = Number(req.params.id);
  let a, refunded = [];
  await D.prisma.$transaction(async (tx) => {
    a = await lockAuction(tx, id);
    if (!a) throw new Error('NOT_FOUND');
    if (a.status === 'DELETED') return;
    // Muzlatilgan barcha stavkalarni (HELD / WON) egalariga qaytaramiz
    const held = await tx.$queryRawUnsafe(`SELECT * FROM auction_bids WHERE auction_id=$1 AND status IN ('HELD','WON')`, id);
    for (const b of held) { await refundBid(tx, b, `Auksion #${id} admin tomonidan o'chirildi — stavka qaytarildi`); refunded.push(b); }
    await tx.$executeRawUnsafe(`UPDATE auctions SET status='DELETED', updated_at=now() WHERE id=$1`, id);
  }, TX);
  for (const b of refunded) notifyUser(b.user_id, `ℹ️ ${lotName(a)} auksioni bekor qilindi. ${fmt(b.amount)} balansingizga qaytarildi.`);
  res.json({ success: true, refunded: refunded.length });
}
async function hAdminResolve(req, res) {
  const id = Number(req.params.id);
  const to = String(req.body?.to || '');
  if (!['seller', 'buyer'].includes(to)) throw uerr('Kimga?');
  let a, r = null;
  await D.prisma.$transaction(async (tx) => {
    a = await lockAuction(tx, id);
    if (!a) throw new Error('NOT_FOUND');
    if (!['DISPUTED', 'TRANSFERRED', 'AWAITING_TRANSFER'].includes(a.status)) throw uerr("Bu holatda hal qilib bo'lmaydi");
    const bid = await topBid(tx, id, ['WON']);
    if (!bid) throw uerr('Stavka topilmadi');
    if (to === 'seller') {
      r = await releaseToSeller(tx, a, bid);
      await tx.$executeRawUnsafe(`UPDATE auctions SET status='COMPLETED', updated_at=now() WHERE id=$1`, id);
    } else {
      await refundBid(tx, bid, `Auksion #${id}: admin qarori bilan qaytarildi`);
      await tx.$executeRawUnsafe(`UPDATE auctions SET status='REFUNDED', updated_at=now() WHERE id=$1`, id);
    }
  }, TX);
  if (to === 'seller') {
    notifyUser(a.seller_id, `✅ Admin qarori: ${lotName(a)} savdosi yakunlandi. Balansingizga ${fmt(r.net)} tushdi.`);
    notifyUser(a.leader_id, `ℹ️ Admin qarori: ${lotName(a)} savdosi sotuvchi foydasiga yakunlandi.`);
  } else {
    notifyUser(a.leader_id, `💸 Admin qarori: ${lotName(a)} uchun ${fmt(a.current_price)} balansingizga qaytarildi.`);
    notifyUser(a.seller_id, `ℹ️ Admin qarori: ${lotName(a)} savdosi bekor qilindi, pul xaridorga qaytarildi.`);
  }
  res.json({ success: true });
}

// ---------- Cron ----------
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const p = D.prisma;
    // 1) Vaqti tugagan faol auksionlar
    const ended = await p.$queryRawUnsafe(`SELECT id FROM auctions WHERE status='ACTIVE' AND ends_at <= now() LIMIT 50`);
    for (const { id } of ended) {
      let a, won = null;
      try {
        await p.$transaction(async (tx) => {
          a = await lockAuction(tx, id);
          if (!a || a.status !== 'ACTIVE' || new Date(a.ends_at) > new Date()) { a = null; return; }
          const bid = await topBid(tx, id, ['HELD']);
          if (bid) {
            await tx.$executeRawUnsafe(`UPDATE auction_bids SET status='WON' WHERE id=$1`, bid.id);
            // Qolgan HELD stavkalar bo'lsa (bo'lmasligi kerak) — qaytaramiz
            const others = await tx.$queryRawUnsafe(`SELECT * FROM auction_bids WHERE auction_id=$1 AND status='HELD'`, id);
            for (const o of others) await refundBid(tx, o);
            await tx.$executeRawUnsafe(`UPDATE auctions SET status='AWAITING_TRANSFER', leader_id=$2, current_price=$3, won_at=now(), updated_at=now() WHERE id=$1`, id, bid.user_id, bid.amount);
            won = bid;
          } else {
            await tx.$executeRawUnsafe(`UPDATE auctions SET status='ENDED_NO_BIDS', updated_at=now() WHERE id=$1`, id);
          }
        }, TX);
      } catch (e) { console.error('[auction] finalize failed', id, e?.message || e); continue; }
      if (!a) continue;
      if (won) {
        notifyUser(won.user_id, `🏆 <b>Tabriklaymiz! Auksionda g'olib bo'ldingiz</b>\n\n📸 ${lotName(a)} — <b>${fmt(won.amount)}</b>\nPul garant (escrow)da saqlanadi. Sotuvchi ${TRANSFER_HOURS} soat ichida akkauntni topshiradi.`);
        notifyUser(a.seller_id, `🏁 <b>Auksion tugadi!</b>\n\n📸 ${lotName(a)} — <b>${fmt(won.amount)}</b> ga sotildi.\n\n${TRANSFER_HOURS} soat ichida Mini App → Auksion → Mening auksionlarim bo'limida akkaunt kirish ma'lumotlarini (login, parol, pochta) yuboring. Xaridor tasdiqlagach pul balansingizga tushadi.`);
      } else {
        notifyUser(a.seller_id, `⌛ Auksion tugadi: ${lotName(a)} — stavka qo'yilmadi.`);
      }
    }
    // 2) Sotuvchi vaqtida topshirmagan — pul xaridorga qaytadi
    const late = await p.$queryRawUnsafe(`SELECT id FROM auctions WHERE status='AWAITING_TRANSFER' AND won_at < now() - ($1 || ' hours')::interval LIMIT 50`, String(TRANSFER_HOURS));
    for (const { id } of late) {
      let a = null;
      try {
        await p.$transaction(async (tx) => {
          a = await lockAuction(tx, id);
          if (!a || a.status !== 'AWAITING_TRANSFER') { a = null; return; }
          const bid = await topBid(tx, id, ['WON']);
          if (bid) await refundBid(tx, bid, `Auksion #${id}: sotuvchi topshirmadi, qaytarildi`);
          await tx.$executeRawUnsafe(`UPDATE auctions SET status='REFUNDED', updated_at=now() WHERE id=$1`, id);
        }, TX);
      } catch (e) { console.error('[auction] refund-late failed', id, e?.message || e); continue; }
      if (a) {
        notifyUser(a.leader_id, `💸 Sotuvchi ${lotName(a)} ni vaqtida topshirmadi. ${fmt(a.current_price)} balansingizga qaytarildi.`);
        notifyUser(a.seller_id, `❌ ${lotName(a)} ni ${TRANSFER_HOURS} soat ichida topshirmadingiz — savdo bekor qilindi.`);
      }
    }
    // 3) Topshirilgan, xaridor javob bermagan — avtomatik yakun
    const auto = await p.$queryRawUnsafe(`SELECT id FROM auctions WHERE status='TRANSFERRED' AND transferred_at < now() - ($1 || ' hours')::interval LIMIT 50`, String(CONFIRM_HOURS));
    for (const { id } of auto) {
      let a = null, r = null;
      try {
        await p.$transaction(async (tx) => {
          a = await lockAuction(tx, id);
          if (!a || a.status !== 'TRANSFERRED') { a = null; return; }
          const bid = await topBid(tx, id, ['WON']);
          if (!bid) { a = null; return; }
          r = await releaseToSeller(tx, a, bid);
          await tx.$executeRawUnsafe(`UPDATE auctions SET status='COMPLETED', updated_at=now() WHERE id=$1`, id);
        }, TX);
      } catch (e) { console.error('[auction] auto-release failed', id, e?.message || e); continue; }
      if (a) notifyUser(a.seller_id, `✅ ${lotName(a)} savdosi avtomatik yakunlandi. Balansingizga ${fmt(r.net)} tushdi.`);
    }
  } catch (e) {
    console.error('[auction] tick error', e?.message || e);
  } finally { ticking = false; }
}

// ---------- Instagram profil rasmini olish ----------
const picTried = new Set();
async function fillProfile(auctionId, ig) {
  if (!D.fetchInstagramBioData || picTried.has(auctionId)) return;
  picTried.add(auctionId);
  try {
    const r = await D.fetchInstagramBioData(ig);
    if (!r || !r.success) { console.warn('[auction] ig bio failed', ig, r && r.error); return; }
    let photoId = '';
    if (r.profilePicUrl) {
      const ir = await fetch(r.profilePicUrl);
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer());
        if (buf.length > 500) {
          const fs = await import('node:fs/promises');
          const crypto = await import('node:crypto');
          await fs.mkdir(IMG_DIR, { recursive: true });
          const name = crypto.createHash('sha1').update(buf).digest('hex') + '.jpg';
          await fs.writeFile(new URL(name, IMG_DIR), buf);
          photoId = 'img:' + name;
        }
      }
    }
    await D.prisma.$executeRawUnsafe(
      `UPDATE auctions SET photo_file_id = CASE WHEN photo_file_id = '' THEN $2 ELSE photo_file_id END, followers = CASE WHEN followers = 0 THEN $3 ELSE followers END, updated_at=now() WHERE id=$1`,
      auctionId, photoId, Math.max(0, Math.round(Number(r.followers) || 0)));
  } catch (e) { console.warn('[auction] fillProfile error', e?.message || e); }
}

// ---------- Telegram post orqali import ----------
const IMG_DIR = new URL('../spa/auc-img/', import.meta.url);
function decodeEnt(t) {
  return String(t)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function parseFollowers(text) {
  const t = text.replace(/ /g, ' ');
  const re = /(\d+(?:[.,]\d+)?)\s*(k|к|ming|минг|тыс\.?|m|млн|mln)?\s*(?:ta\s*)?(obunachi|obuna|follower|подписч|фоловер)/i;
  const m = t.match(re) || t.match(/(?:obunachi|follower|подписч)[^\d]{0,12}(\d[\d\s.,]*)(\s*(?:k|к|ming|тыс|m|млн))?/i);
  if (!m) return 0;
  let num, mult;
  if (m[3]) { num = parseFloat(m[1].replace(',', '.')); mult = (m[2] || '').toLowerCase(); }
  else { num = parseFloat(m[1].replace(/\s/g, '').replace(',', '.')); mult = (m[2] || '').trim().toLowerCase(); }
  if (/^(k|к|ming|минг|тыс)/.test(mult)) num *= 1000;
  if (/^(m|млн|mln)$/.test(mult)) num *= 1e6;
  return Math.round(num) || 0;
}
async function hImport(req, res) {
  const raw = String(req.body?.url || '').trim();
  const m = raw.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,64})\/(\d{1,9})/i);
  if (!m) throw uerr("Havola noto'g'ri. Masalan: https://t.me/kanal/123 (ochiq kanal posti)");
  const ch = m[1], id = m[2];
  const r = await fetch(`https://t.me/${ch}/${id}?embed=1&mode=tme`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TelegramBot)' } });
  if (!r.ok) throw uerr('Postni ochib bo\'lmadi');
  const html = await r.text();
  if (/tgme_widget_message_error/.test(html) || !/tgme_widget_message/.test(html)) throw uerr('Post topilmadi yoki kanal yopiq');
  const tm = html.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  const text = tm ? decodeEnt(tm[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim() : '';
  const urls = [];
  const re = /tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g;
  let pm;
  while ((pm = re.exec(html)) && urls.length < 3) if (!urls.includes(pm[1])) urls.push(pm[1]);
  const fs = await import('node:fs/promises');
  const crypto = await import('node:crypto');
  await fs.mkdir(IMG_DIR, { recursive: true });
  const photos = [];
  for (const u of urls) {
    try {
      const ir = await fetch(u);
      if (!ir.ok) continue;
      const buf = Buffer.from(await ir.arrayBuffer());
      if (buf.length < 500 || buf.length > 15 * 1024 * 1024) continue;
      const name = crypto.createHash('sha1').update(buf).digest('hex') + '.jpg';
      await fs.writeFile(new URL(name, IMG_DIR), buf);
      photos.push({ id: 'img:' + name, url: '/auc-img/' + name });
    } catch (e) { console.warn('[auction] import img failed', e?.message || e); }
  }
  let ig = '';
  const rawText = tm ? tm[1] : '';
  const im = rawText.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i) || text.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i) || text.match(/@([A-Za-z0-9._]{2,30})/);
  if (im) ig = im[1].toLowerCase();
  res.json({ success: true, text: text.slice(0, 1500), photos, igUsername: ig, followers: parseFollowers(text) });
}

// ---------- Qimmat atmetka qoidasi ----------
const TAG_RULES_KEY = 'premium_tag_rules';
async function hTagRulesGet(req, res) {
  const r = await D.prisma.setting.findUnique({ where: { key: TAG_RULES_KEY } }).catch(() => null);
  let admin = req.pgUser ? isAdmin(req.pgUser) : false;
  if (!admin && req.headers.authorization && req.headers.authorization.startsWith('tma ')) {
    try {
      const authData = req.headers.authorization.slice(4);
      const params = new URLSearchParams(authData);
      const userStr = params.get('user');
      if (userStr) {
        const u = JSON.parse(userStr);
        if (u && adminIds().includes(String(u.id))) admin = true;
      }
    } catch (e) {}
  }
  res.json({ success: true, text: r?.value || '', isAdmin: admin });
}
async function hTagRulesSet(req, res) {
  const text = String(req.body?.text || '').slice(0, 16000);
  await D.prisma.setting.upsert({ where: { key: TAG_RULES_KEY }, update: { value: text }, create: { key: TAG_RULES_KEY, value: text } });
  res.json({ success: true, text });
}

// ---------- Telegram Stars kursi (admin) ----------
const STARS_RATE_KEY = 'stars_to_som_rate';
async function readStarsRate() {
  const r = await D.prisma.setting.findUnique({ where: { key: STARS_RATE_KEY } }).catch(() => null);
  const v = Number(r?.value);
  return v > 0 ? v : (Number(process.env.STARS_TO_SOM_RATE) || 160);
}
async function hStarsRateGet(req, res) { res.json({ success: true, rate: await readStarsRate() }); }
async function hStarsRateSet(req, res) {
  const v = Math.round(Number(String(req.body?.rate ?? '').replace(/[^0-9.]/g, '')));
  if (!(v > 0 && v <= 1000000)) throw uerr("1 Stars narxi noto'g'ri");
  await D.prisma.setting.upsert({ where: { key: STARS_RATE_KEY }, update: { value: String(v) }, create: { key: STARS_RATE_KEY, value: String(v) } });
  res.json({ success: true, rate: v });
}
// ---------- Atmetka uchun ajratilgan pul (admin) ----------
const TAG_BUDGET_KEYS = { TAG_ONLY: 'tag_campaign_budget_v1', CSGO: 'tag_campaign_budget_csgo_v1', CSGO_TAG: 'tag_campaign_budget_csgo_tag_v1' };
async function readTagBudgetA(key) {
  const r = await D.prisma.setting.findUnique({ where: { key } }).catch(() => null);
  let v = null; try { v = r ? JSON.parse(r.value) : null; } catch {}
  const total = Math.max(0, Math.floor(Number(v?.total) || 0));
  const spent = Math.min(total, Math.max(0, Math.floor(Number(v?.spent) || 0)));
  return { enabled: total > 0, total, spent, remaining: Math.max(0, total - spent) };
}
async function hTagBudgetsGet(req, res) {
  const out = {};
  for (const m of Object.keys(TAG_BUDGET_KEYS)) out[m] = await readTagBudgetA(TAG_BUDGET_KEYS[m]);
  res.json({ success: true, budgets: out });
}
async function hTagBudgetSet(req, res) {
  const m = String(req.body?.method || ''); const key = TAG_BUDGET_KEYS[m];
  if (!key) throw uerr("Noto'g'ri tur");
  const mode = String(req.body?.mode || 'set');
  const amount = Math.floor(Number(req.body?.total));
  const cur = await readTagBudgetA(key);
  let total, spent = cur.spent;
  if (mode === 'clear') { total = 0; spent = 0; }
  else if (mode === 'add') { if (!(amount > 0 && amount <= 1e12)) throw uerr("Summa noto'g'ri"); total = (cur.enabled ? cur.total : 0) + amount; if (!cur.enabled) spent = 0; }
  else { if (!(amount >= 0 && amount <= 1e12)) throw uerr("Summa noto'g'ri"); total = amount; if (total === 0) spent = 0; else if (spent > total) throw uerr("Yangi summa allaqachon to'langan puldan (" + spent + " so'm) kam bo'lmasligi kerak"); }
  const value = JSON.stringify({ total, spent, setAt: new Date().toISOString() });
  await D.prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  res.json({ success: true, budget: await readTagBudgetA(key) });
}
// ---------- Atmetka prosmotr narxlari (admin) ----------
const REWARD_TIERS_KEY = 'tag_campaign_reward_tiers';
const PREMIUM_TIERS_KEY = 'tag_campaign_csgo_tag_reward_tiers'; // qimmat atmetka prosmotr narxlari
const tiersKey = (req) => (String(req.query?.kind || req.body?.kind || '') === 'premium' ? PREMIUM_TIERS_KEY : REWARD_TIERS_KEY);
async function hTiersGet(req, res) {
  const r = await D.prisma.setting.findUnique({ where: { key: tiersKey(req) } }).catch(() => null);
  let t = [];
  try { t = JSON.parse(r?.value || '[]'); } catch {}
  res.json({ success: true, tiers: Array.isArray(t) ? t : [] });
}
async function hTiersSet(req, res) {
  const arr = Array.isArray(req.body?.tiers) ? req.body.tiers : [];
  const map = new Map();
  for (const x of arr) {
    const views = parseInt(x?.views, 10), reward = parseInt(x?.reward, 10);
    if (!(views > 0 && views <= 1e10)) throw uerr("Prosmotr soni noto'g'ri");
    if (!(reward > 0 && reward <= MAX_PRICE)) throw uerr("Narx noto'g'ri");
    map.set(views, reward);
  }
  const tiers = [...map.entries()].map(([views, reward]) => ({ views, reward })).sort((a, b) => a.views - b.views).slice(0, 30);
  const value = JSON.stringify(tiers);
  const tkey = tiersKey(req);
  await D.prisma.setting.upsert({ where: { key: tkey }, update: { value }, create: { key: tkey, value } });
  res.json({ success: true, tiers });
}

export function registerAuction(app, deps) {
  D = deps;
  const { authMiddleware: A, pgUserMiddleware: P, adminMiddleware: AD } = deps;
  const ready = migrate().then(() => console.log('[auction] tables ready')).catch((e) => console.error('[auction] migrate failed', e));
  const R = (fn) => [A, P, wrap(async (req, res) => { await ready; await fn(req, res); })];
  app.get('/api/auction/me', ...R(hMe));
  app.get('/api/auction/list', ...R(hList));
  app.get('/api/auction/my', ...R(hMy));
  app.post('/api/auction/admin/import', A, P, AD, wrap(hImport));
  app.get('/api/auction/tag-rules', wrap(hTagRulesGet));
  app.get('/api/auction/stars-rate', A, P, wrap(hStarsRateGet));
  app.post('/api/auction/admin/stars-rate', A, P, AD, wrap(hStarsRateSet));
  app.get('/api/auction/admin/tag-budgets', A, P, AD, wrap(hTagBudgetsGet));
  app.post('/api/auction/admin/tag-budget', A, P, AD, wrap(hTagBudgetSet));
  app.post('/api/auction/admin/tag-rules', A, P, AD, wrap(hTagRulesSet));
  app.get('/api/auction/admin/reward-tiers', A, P, AD, wrap(hTiersGet));
  app.post('/api/auction/admin/reward-tiers', A, P, AD, wrap(hTiersSet));
  app.get('/api/auction/admin/list', A, P, AD, wrap(async (q, s) => { await ready; await hAdminList(q, s); }));
  app.post('/api/auction/admin/:id/approve', A, P, AD, wrap(hAdminApprove));
  app.post('/api/auction/admin/:id/reject', A, P, AD, wrap(hAdminReject));
  app.post('/api/auction/admin/:id/resolve', A, P, AD, wrap(hAdminResolve));
  app.post('/api/auction/admin/:id/delete', A, P, AD, wrap(hAdminDelete));
  app.post('/api/auction', ...R(hCreate));
  app.get('/api/auction/:id', ...R(hGet));
  app.post('/api/auction/:id/bid', ...R(hBid));
  app.post('/api/auction/:id/cancel', ...R(hCancel));
  app.post('/api/auction/:id/transfer', ...R(hTransfer));
  app.post('/api/auction/:id/confirm', ...R(hConfirm));
  app.post('/api/auction/:id/dispute', ...R(hDispute));
  ready.then(() => { setInterval(tick, 30000); setTimeout(tick, 5000); });
  console.log('[auction] routes registered');
}
