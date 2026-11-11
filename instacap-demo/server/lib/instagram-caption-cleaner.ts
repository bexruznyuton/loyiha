/**
 * Instagram embed/oEmbed matniga qo'shilib qoladigan profil va UI metadatasini
 * olib tashlaydi. Qoidalar faqat satr boshi/oxiridagi aniq Instagram formatlariga
 * tegadi; caption ichidagi mention, hashtag, emoji va ko'p tilli matn saqlanadi.
 */
export function cleanInstagramCaption(raw: string): string {
  if (!raw) return "";

  let text = raw.replace(/\r\n?/g, "\n").trim();

  // oEmbed ba'zan: `951 likes, 37 comments - user on ...: "caption"`.
  text = text.replace(
    /^[\d.,\s\u00a0]+\s+likes?,\s*[\d.,\s\u00a0]+\s+comments?\s*[-\u2013\u2014]\s*[^:\n]{1,120}:\s*["\u201c]?\s*/iu,
    "",
  );

  // Embed parent elementi: `username's caption` yoki `username’s caption`.
  text = text.replace(
    /^(?:["\u201c]\s*)?@?[a-z0-9._]{1,30}(?:'s|\u2019s)\s+/iu,
    "",
  );

  // Ayrim SaveAsBot javoblarida username CJK captionga ajratgichsiz yopishadi:
  // `vayner_top_50k新たな冒険...`. Faqat keyingi belgi yapon/xitoy/koreys
  // yozuvi bo'lganda olib tashlaymiz, oddiy lotincha captionlarga tegmaymiz.
  text = text.replace(
    /^(?:["\u201c]\s*)?@?[a-z0-9._]{2,30}(?=[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])/iu,
    "",
  );

  // Standart oEmbed sarlavhasi: `username on Instagram: "caption"`.
  text = text.replace(
    /^[^:\n]{1,120}\s+on Instagram:\s*["\u201c]?\s*/iu,
    "",
  );

  const trailingUiPatterns = [
    /\s*View all\s+[\d.,\s\u00a0]+\s+comments?\s*["\u201d]?\s*$/iu,
    /\s*View\s+[\d.,\s\u00a0]+\s+comments?\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})[\d.,\s\u00a0]+\s+likes?\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})Liked by\s+.+?\s+and\s+(?:[\d.,\s\u00a0]+\s+)?others\s*["\u201d]?\s*$/iu,
    /(?:\n|\s{2,})See translation\s*["\u201d]?\s*$/iu,
  ];

  // Bir natijada comments + likes kabi bir nechta UI qatori bo'lishi mumkin.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of trailingUiPatterns) {
      const cleaned = text.replace(pattern, "").trim();
      if (cleaned !== text) {
        text = cleaned;
        changed = true;
      }
    }
  }

  // Captionning o'zini o'rab turgan qo'shtirnoqni olib tashlaymiz.
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("\u201c") && text.endsWith("\u201d"))) {
    text = text.slice(1, -1).trim();
  }

  return text.replace(/\n{3,}/g, "\n\n").trim();
}
