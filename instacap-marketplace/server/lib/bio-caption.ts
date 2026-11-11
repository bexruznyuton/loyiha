import type { InstagramBioResult } from '../routes/instagram-bio';

// bot.php'dagi bio_olish handleridagi karta matni bilan BIR XIL formatga
// mos — WebApp'dagi "Bio yuklash" tugmasi ham xuddi shu ko'rinishdagi
// xabarni Top_sxema bot orqali yuboradi (foydalanuvchi tajribasi izchil bo'lsin).
const L10N = {
  uz: { noBio: 'Bio kiritilmagan', verified: 'Tasdiqlangan akkount', private: 'Yopiq akkount' },
  ru: { noBio: 'Био не указано', verified: 'Подтверждённый аккаунт', private: 'Закрытый аккаунт' },
  en: { noBio: 'No bio set', verified: 'Verified account', private: 'Private account' },
} as const;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildBioCaption(data: InstagramBioResult, lang: string): string {
  const t = L10N[lang as keyof typeof L10N] || L10N.uz;

  const bUsername = escapeHtml(data.username);
  const bFullName = escapeHtml(data.fullName);
  // <blockquote> — Telegram'da chapida chiziqli iqtibos-karta ko'rinishi beradi
  // (skrinshotdagi kabi), ichidagi <code> esa bosganda nusxalanadigan qiladi.
  const bBio = data.biography.trim()
    ? `<blockquote><code>${escapeHtml(data.biography.trim())}</code></blockquote>`
    : `<i>${t.noBio}</i>`;
  const nameLine = bFullName ? ` (${bFullName})` : '';

  let badges = '';
  if (data.isVerified) badges += `\n<tg-emoji emoji-id="5461010007300522424">✅</tg-emoji> ${t.verified}`;
  if (data.isPrivate) badges += `\n🔒 ${t.private}`;

  let linkLine = '';
  if (data.externalUrl.trim()) {
    linkLine = `\n\n<tg-emoji emoji-id="5271974997521350631">🔗</tg-emoji> ${escapeHtml(data.externalUrl.trim())}`;
  }

  // Tartib: 1) username, 2) bio, 3) havola — statistika (obunachi/obuna/post)
  // bullet ro'yxati olib tashlandi.
  // tg-emoji — premium (maxsus) emoji: premium foydalanuvchilarga animatsion
  // ikonka, oddiylarga ichidagi emoji fallback bo'lib ko'rinadi (bot.php'dagi
  // /bio_olish bilan BIR XIL ID'lar — ikkalasi ham bir xil ko'rinsin).
  return (
    `<tg-emoji emoji-id="5879770735999717115">👤</tg-emoji> <b>@${bUsername}</b>${nameLine}\n\n` +
    `<tg-emoji emoji-id="5451636889717062286">✨</tg-emoji> ${bBio}` +
    badges +
    linkLine
  );
}
