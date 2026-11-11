/**
 * Yangi akkaunt arizalari uchun in-memory holat. Admin chat'ida yuborilgan
 * media albom + tugmali xabar ma'lumotlarini, hamda admin tomonidan o'rnatilgan
 * narxni saqlaydi. Bu narx tasdiqlash bosilganida DB ga yoziladi.
 *
 * Stars_bazar uslubi: narx belgilanmaguncha ✅ Tasdiqlash tugmasi ko'rinmaydi.
 * Rad etish bosilsa — albom + tugmali xabar to'liq o'chiriladi.
 */
export interface AdminAccountSubmission {
  accountId: number;
  adminChatId: number;
  igUsername: string;
  submittedBy: string;
  mediaGroupMsgIds: number[];
  buttonsMsgId: number;
  priceAskMsgId?: number;
  price?: number;
  // 'edit' — ACTIVE akkaunt uchun rasm/skrinshot yangilash so'rovi (narx
  // belgilash bosqichi YO'Q, akkaunt allaqachon narxga ega). Yo'q/undefined
  // bo'lsa — eski xatti-harakat bilan bir xil: yangi akkaunt arizasi ('new').
  kind?: 'new' | 'edit';
}

// MUHIM: bitta akkaunt arizasi BIR NECHA adminga BIR VAQTDA yuboriladi
// (notifyAdminsOfNewAccount — har bir admin uchun alohida mediaGroup + tugmali
// xabar, alohida message_id'lar bilan, o'sha adminning O'Z chatida). Avval bu
// yerda `Map<accountId, AdminAccountSubmission>` ishlatilardi — ya'ni FAQAT
// BITTA admin uchun joy bor edi, va har bir admin `saveSubmission` chaqirganda
// bir-birini USTIDAN YOZARDI. Natijada: qaysi admin oxirgi bo'lib "yozilgan"
// bo'lsa (masalan ADMIN_TELEGRAM_IDS ro'yxatida oxirgi turgan), FAQAT o'sha
// admin uchun to'g'ri ishlar edi — boshqa admin narx yuborsa yoki tasdiqlasa,
// `editMessageText`/`deleteMessage` NOTO'G'RI chat/message_id juftligi bilan
// chaqirilib, Telegram "message not found" xatosi bilan jimgina (`.catch`)
// muvaffaqiyatsiz bo'lardi — aynan foydalanuvchi ta'riflagan nosozlik shu edi.
//
// Endi: accountId → (adminChatId → AdminAccountSubmission) — har bir admin
// o'zining alohida holatiga ega, boshqa adminni "bosib" yubormaydi.
const submissionsByAccount = new Map<number, Map<number, AdminAccountSubmission>>();
// adminChatId → accountId (narx kutilayotgan admin) — bu allaqachon to'g'ri
// per-admin edi, o'zgarishsiz qoldi.
const awaitingPrice = new Map<number, number>();

export function saveSubmission(sub: AdminAccountSubmission): void {
  let byAdmin = submissionsByAccount.get(sub.accountId);
  if (!byAdmin) {
    byAdmin = new Map();
    submissionsByAccount.set(sub.accountId, byAdmin);
  }
  byAdmin.set(sub.adminChatId, sub);
}
export function getSubmission(accountId: number, adminChatId: number): AdminAccountSubmission | undefined {
  return submissionsByAccount.get(accountId)?.get(adminChatId);
}
/** Shu akkauntni ko'rgan BARCHA adminlarning holatini qaytaradi — bitta admin
 *  tasdiqlagan/rad etganda, qolgan adminlarning xabarlarini ham tozalash uchun. */
export function getAllSubmissionsForAccount(accountId: number): AdminAccountSubmission[] {
  const byAdmin = submissionsByAccount.get(accountId);
  return byAdmin ? Array.from(byAdmin.values()) : [];
}
/** Faqat BITTA adminning holatini o'chiradi (masalan narx bekor qilinganda). */
export function deleteSubmission(accountId: number, adminChatId: number): void {
  const byAdmin = submissionsByAccount.get(accountId);
  if (!byAdmin) return;
  awaitingPrice.delete(adminChatId);
  byAdmin.delete(adminChatId);
  if (byAdmin.size === 0) submissionsByAccount.delete(accountId);
}
/** Akkaunt yakuniy hal qilinganda (tasdiqlandi/rad etildi) — BARCHA
 *  adminlarning holatini tozalaydi (chaqiruvchi avval har biriga xabar
 *  yuborish/tahrirlashni o'zi bajaradi). */
export function deleteAllSubmissionsForAccount(accountId: number): void {
  const byAdmin = submissionsByAccount.get(accountId);
  if (byAdmin) {
    for (const adminChatId of byAdmin.keys()) awaitingPrice.delete(adminChatId);
  }
  submissionsByAccount.delete(accountId);
}

export function setAwaitingPrice(adminChatId: number, accountId: number): void {
  awaitingPrice.set(adminChatId, accountId);
}
export function getAwaitingPrice(adminChatId: number): number | undefined {
  return awaitingPrice.get(adminChatId);
}
export function clearAwaitingPrice(adminChatId: number): void {
  awaitingPrice.delete(adminChatId);
}

// ─── Admin ↔ Owner anonim chat ───
// Admin akkaunt tekshirayotganda ownerdan biror narsa so'rashi mumkin.
// Tugma bosadi → keyingi matn xabar Top_sxema bot orqali ownerga yuboriladi.
// Owner ham "✍️ Javob yozish" tugmasi orqali javob yozishi mumkin.

const CHAT_TTL_MS = 10 * 60 * 1000; // 10 daqiqa

// adminChatId → {accountId, ownerTgId, expiresAt}
const awaitingAdminMessage = new Map<number, { accountId: number; ownerTgId: number; expiresAt: number }>();
// ownerTgId → {accountId, adminChatId, expiresAt}
const awaitingOwnerReply = new Map<number, { accountId: number; adminChatId: number; expiresAt: number }>();

// accountId → adminChatId — ushbu akkaunt egasi bilan OXIRGI yozgan admin.
// MUHIM: avval owner "✍️ Javob yozish" bosganda javob HAR DOIM ADMIN_IDS[0]ga
// (ro'yxatdagi birinchi adminga) yuborilardi — qaysi admin ASLIDA yozgan
// bo'lishidan qat'i nazar. Bir nechta admin bo'lganda javob noto'g'ri odamga
// ketardi (yoki "yo'qolgandek" tuyulardi). Endi har safar admin owner'ga
// xabar yozganda shu yerga yoziladi, owner javob bergani shu yerdan o'qiladi.
const lastChatAdmin = new Map<number, number>();
export function setLastChatAdmin(accountId: number, adminChatId: number): void {
  lastChatAdmin.set(accountId, adminChatId);
}
export function getLastChatAdmin(accountId: number): number | undefined {
  return lastChatAdmin.get(accountId);
}

export function setAwaitingAdminMessage(adminChatId: number, accountId: number, ownerTgId: number): void {
  awaitingAdminMessage.set(adminChatId, { accountId, ownerTgId, expiresAt: Date.now() + CHAT_TTL_MS });
}
export function getAwaitingAdminMessage(adminChatId: number): { accountId: number; ownerTgId: number } | null {
  const v = awaitingAdminMessage.get(adminChatId);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    awaitingAdminMessage.delete(adminChatId);
    return null;
  }
  return { accountId: v.accountId, ownerTgId: v.ownerTgId };
}
export function clearAwaitingAdminMessage(adminChatId: number): void {
  awaitingAdminMessage.delete(adminChatId);
}

export function setAwaitingOwnerReply(ownerTgId: number, accountId: number, adminChatId: number): void {
  awaitingOwnerReply.set(ownerTgId, { accountId, adminChatId, expiresAt: Date.now() + CHAT_TTL_MS });
}
export function getAwaitingOwnerReply(ownerTgId: number): { accountId: number; adminChatId: number } | null {
  const v = awaitingOwnerReply.get(ownerTgId);
  if (!v) return null;
  if (v.expiresAt < Date.now()) {
    awaitingOwnerReply.delete(ownerTgId);
    return null;
  }
  return { accountId: v.accountId, adminChatId: v.adminChatId };
}
export function clearAwaitingOwnerReply(ownerTgId: number): void {
  awaitingOwnerReply.delete(ownerTgId);
}

export function buildAccountButtons(accountId: number, hasPrice: boolean) {
  const row1 = hasPrice
    ? [
        { text: '✅ Tasdiqlash', callback_data: `mkt:verify:${accountId}:approve` },
        { text: '❌ Rad etish', callback_data: `mkt:verify:${accountId}:reject` },
      ]
    : [{ text: '❌ Rad etish', callback_data: `mkt:verify:${accountId}:reject` }];
  const row2 = [
    {
      text: hasPrice ? "💰 Narxni o'zgartirish" : '💰 Narx belgilash',
      callback_data: `mkt:verify:${accountId}:price`,
    },
  ];
  // Anonim chat: admin owner'ga xabar yozishi mumkin
  const row3 = [
    { text: '💬 Egasiga yozish', callback_data: `mkt:verify:${accountId}:chat` },
  ];
  return { inline_keyboard: [row1, row2, row3] };
}

export function buildAccountCaption(sub: AdminAccountSubmission): string {
  const priceLine = sub.price
    ? `\n💰 <b>${sub.price.toLocaleString('uz-UZ')} so'm</b>`
    : '';
  const hint = sub.price
    ? "\n\n<i>Narx belgilangan. Tasdiqlang yoki rad eting.</i>"
    : "\n\n<i>Avval narx belgilang, keyin tasdiqlash mumkin.</i>";
  return (
    `🆕 <b>Yangi e'lon arizasi</b>\n\n` +
    `👤 <b>@${sub.igUsername}</b>\n` +
    `🙋 Yuboruvchi: ${sub.submittedBy}\n` +
    `🆔 Akkaunt: <code>#${sub.accountId}</code>` +
    priceLine +
    hint
  );
}

// ─── Akkaunt YANGILASH so'rovi (ACTIVE akkaunt, faqat rasm/skrinshot) ───
// Narx allaqachon bor — bosqich shart emas, faqat Tasdiqlash/Rad etish.
export function buildEditAccountButtons(accountId: number) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Tasdiqlash', callback_data: `mkt:editreq:${accountId}:approve` },
        { text: '❌ Rad etish', callback_data: `mkt:editreq:${accountId}:reject` },
      ],
    ],
  };
}

export function buildEditAccountCaption(sub: AdminAccountSubmission): string {
  return (
    `✏️ <b>Akkaunt yangilanish so'rovi</b>\n\n` +
    `👤 <b>@${sub.igUsername}</b>\n` +
    `🙋 Yuboruvchi: ${sub.submittedBy}\n` +
    `🆔 Akkaunt: <code>#${sub.accountId}</code>\n\n` +
    `<i>Egasi yangi rasm/skrinshot yubordi. Tasdiqlasangiz akkauntga darhol qo'llaniladi.</i>`
  );
}
