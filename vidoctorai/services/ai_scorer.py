import json
import time
import re
import logging
import requests
from config import OPENROUTER_API_KEY

log = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
OPENROUTER_MODEL = "google/gemini-2.5-flash"
# Asosiy model 429/5xx bersa urinishlar shu modelga almashadi (alohida kvota).
OPENROUTER_FALLBACK_MODEL = "google/gemini-2.5-flash-lite"
MAX_ATTEMPTS = 5
_RETRY_DELAYS = [2, 6, 15, 15]  # soniya: 1→2, 2→3, 3→4, 4→5-urinish orasida
_FATAL_STATUSES = {401, 402, 403}

PROMPT_TEMPLATE = """Siz Instagram Reels viral marketing ekspertisiz. Vazifangiz: bu video haqiqatda rekka chiqib, ko'p ko'rilishi ehtimolini INSON PSIXOLOGIYASI asosida baholash.

═══ BAL TIZIMI — AVVAL O'QING ═══
Bu ballar Instagram Reels da HAQIQIY rekka chiqish ehtimolini bildiradi. HAR BIR videoni MUSTAQIL baholang — oldingi baholaringizni "eslab" o'rtacha songa moslashtirmang, har safar 1 dan 10 gacha BUTUN diapazonni haqiqiy imkoniyat sifatida ko'ring:

10 = Dunyodagi eng yaxshi 0.1% video (Khaby Lame, MrBeast darajasi)
9  = Juda kuchli, viral bo'lishi deyarli aniq
8  = Yaxshi, sezilarli kuchli tomonlari bor, kamchiliklari kam
7  = Yaxshi, lekin bitta aniq kamchiligi bor
6  = O'rtacha — ba'zi qismlari ishlaydi, ba'zilari yo'q
5  = Zaif — ko'p kamchiliklar, kuchli tomoni deyarli yo'q
4  = Juda zaif — asosiy elementlarning aksariyati ishlamaydi (zerikarli hook, past sifat, hech qanday o'ziga xoslik yo'q)
3  = Jiddiy muammolar — deyarli hech narsa ishlamaydi
2  = Sifatsiz/tasodifiy — professional darajadan juda uzoq
1  = Videoda ushbu mezon deyarli umuman yo'q

MUHIM: 6-7 ball "xavfsiz o'rtacha" degani EMAS. Agar video haqiqatan ham zerikarli, sifatsiz yoki o'ziga xosligi bo'lmasa — 2, 3 yoki 4 ball bering, cho'chimang. Aksincha, agar biror jihat haqiqatan kuchli bo'lsa — 8 yoki 9 berishdan tortinmang. Ballarni "6 yoki 7 ga yaqinlashtirish" TAQIQLANADI — har bir ball FAQAT o'sha video haqiqatda ko'rsatgan sifatga asoslanishi kerak.

═══ 1-QADAM: VIDEO TURINI ANIQLA ═══
Sizga videodan olingan HAQIQIY KADRLAR (rasmlar) va hook audiosi berilgan.
Video turini FAQAT shu kadrlar va audioga qarab aniqlang — taxmin qilmang:
- Kadrlarda odam kamera oldida gapiryaptimi? Sport maydonimi? Mashinami?
- Audioda nutq bormi yoki faqat musiqami?
FAQAT BITTASINI tanla:
- "edit"         — tez montaj/tranzisiyalar, musiqa asosli, nutq yo'q yoki minimal
- "talking_head" — kamera oldida gapiruvchi odam, nutq asosiy kontent
- "music_only"   — hech qanday nutq yo'q, faqat musiqa/instrumental/beat
- "celebrity"    — mashhur bloggerlar, sportchilar, taniqli yuzlar ko'rinadi
- "sports"       — sport ko'rinishlari (futbol, basketball, boks va h.k.)
- "car_moto"     — avtomobil, mototsikl ko'rsatish yoki poyga
- "tutorial"     — ko'rsatma/qo'llanma, ekran yozuvi yoki text overlay ko'p
- "lifestyle"    — kundalik hayot, vlog, sayohat, ovqat uslubi
- "other"        — yuqoridagilardan hech biriga to'g'ri kelmasa

═══ 2-QADAM: TURGA QARAB BAHOLASH VAZNINI O'ZGARTIR ═══
edit / music_only:       Vizual×0.35 + Hook×0.30 + Audio×0.25 + Kontent×0.10
sports / car_moto:       Hook×0.35 + Vizual×0.30 + Kontent×0.25 + Audio×0.10
celebrity:               Kontent×0.35 + Hook×0.30 + Vizual×0.25 + Audio×0.10
talking_head / tutorial: Kontent×0.40 + Hook×0.30 + Audio×0.20 + Vizual×0.10
lifestyle / other:       Hook×0.35 + Kontent×0.30 + Vizual×0.20 + Audio×0.15

═══ 3-QADAM: TANQIDIY BAHOLASH ═══

🎣 HOOK (0-10) — Birinchi 3 soniyada tomoshabin SCROLL qilishni to'xtatadimi?
- Hech qanday qiziqarli element yo'q, zerikarli boshlanish → 2-4
- Bitta zaif urinish bor, lekin kuchsiz → 5-6
- Aniq qiziqish uyg'otadi, lekin mukammal emas → 7
- Darhol diqqatni tortadi, kutilmagan/kuchli → 8-9
hook_comment: hook TURINI + asosiy kuchli/zaif tomonni yoz — tirnoq ichida so'z KELTIRMA.

🎬 VIZUAL (0-10)
- Past sifat, yomon yoritish, bir xil/statik kadrlar, hech qanday dinamika yo'q → 2-4
- O'rtacha sifat, lekin fon oddiy yoki dinamika kam (masalan: faqat o'tirgan odam, oddiy fon) → 5-6
- Yaxshi sifat, ba'zi jozibali elementlar bor → 7
- Professional darajadagi rang/yorug'lik/harakat → 8-9
Har bir video turi uchun HAQIQIY kadrlarga qarab baholang — "talking_head har doim 6-7" degan qat'iy qoida YO'Q: agar fon juda past sifat yoki yorug'lik yomon bo'lsa, past ball bering.

🗣️ AUDIO (0-10)
- Shovqin, tushunarsiz/tez/sekin nutq, zerikarli yoki umuman mos kelmaydigan musiqa → 2-4
- Nutq/musiqa tushunarli, lekin oddiy va ta'sirsiz → 5-6
- Ravon, aniq, videoga mos → 7
- Professional darajada jozibali (ohang, ritm, energiya) → 8-9

📝 KONTENT (0-10) — Ulashish/saqlash/fikr yozishga undaydimi?
- Mavzu juda eski, foydasiz yoki minglab marta takrorlangan, hech qanday yangilik yo'q → 2-4
- Tanish mavzu, ozgina foydali, lekin o'ziga xos emas → 5-6
- Foydali yoki qiziqarli, ozgina o'ziga xoslik bor → 7
- Noyob, chuqur yoki kutilmagan burilish bilan → 8-9
"O'xshash maslahat ko'p bor" degani AVTOMATIK 6-7 emas — agar maslahat juda sayoz/foydasiz bo'lsa, 3-4 bering.

═══ TEXNIK MA'LUMOTLAR (qo'shimcha signal, asosiy emas) ═══
DATA_PLACEHOLDER

═══ 4-QADAM: VIRAL EHTIMOL (maksimal 88%) ═══
2-QADAMdagi tur vaznini ishlatib, 4 ta ballning vaznli o'rtachasini hisoblang, so'ng uni 0-100 shkalaga o'tkazing (masalan o'rtacha ball 3/10 bo'lsa, viral_percentage taxminan 20-30% atrofida bo'lishi kerak — 50%+ EMAS). Kichik tuzatishlar:
- 15-60 soniya, vertikal format: +3%
- celebrity/sports'da haqiqatan noyob lahza bo'lsa: +8%
Ballar past bo'lsa, viral_percentage ham PAST bo'lishi SHART — ballarni yuqori ko'rsatib, keyin foizni "xavfsiz" o'rtachaga qaytarish TAQIQLANADI.
CHEKLOV: viral_percentage hech qachon 88% dan oshmasin. 89-100% mumkin emas.

Javobni FAQAT quyidagi JSON strukturasida ber (bir qatorda, boshqa hech narsa yozma).
DIQQAT: quyidagi qiymatlar FAQAT STRUKTURA namunasi — izohlarni O'ZINGIZ shu videoga qarab yozing, namunadan KO'CHIRMANG:
{"video_type":"<tur>","video_type_comment":"<nima uchun shu tur>","hook_score":<0-10>,"hook_comment":"<izoh>","visual_score":<0-10>,"visual_comment":"<izoh>","audio_score":<0-10>,"audio_comment":"<izoh>","content_score":<0-10>,"content_comment":"<izoh>","viral_percentage":<0-88>,"viral_comment":"<izoh>","overall_comment":"<kuchli va zaif tomon>"}

Qoidalar:
- Har bir izoh MAKSIMAL 1 ta qisqa gap (15-25 so'z) — SHU VIDEOGA XOS, konkret bo'lsin
- Ballarni video HAQIQIY sifatiga qarab bering — past sifat uchun 2-4 dan tortinmang, yuqori sifat uchun 8-9 dan tortinmang
- TAQIQ: viral_percentage = 89 va undan yuqori berma
- overall_comment da ENG KUCHLI va ENG ZAIF tomonni aniq yoz
- MAJBURIY: barcha izoh matnlarini (video_type_comment, hook_comment, visual_comment, audio_comment, content_comment, viral_comment, overall_comment) FAQAT LANG_PLACEHOLDER tilida yoz — boshqa til TAQIQLANADI"""

LANG_NAMES = {"uz": "o'zbek", "ru": "rus (русский)", "en": "ingliz (English)"}

VIDEO_TYPE_LABELS = {
    "edit":         "🎬 Edit video",
    "talking_head": "🎤 Nutqli video",
    "music_only":   "🎵 Musiqali video",
    "celebrity":    "⭐ Mashhur shaxs",
    "sports":       "⚽ Sport video",
    "car_moto":     "🚗 Avto/Moto",
    "tutorial":     "📚 Ko'rsatma",
    "lifestyle":    "🌅 Lifestyle/Vlog",
    "other":        "📹 Umumiy video",
}

DEFAULT_RESULT = {
    "video_type": "other",
    "video_type_comment": "Video turi aniqlanmadi.",
    "hook_score": 6, "hook_comment": "Tahlil to'liq amalga oshmadi.",
    "visual_score": 6, "visual_comment": "Tahlil to'liq amalga oshmadi.",
    "audio_score": 6, "audio_comment": "Tahlil to'liq amalga oshmadi.",
    "content_score": 6, "content_comment": "Tahlil to'liq amalga oshmadi.",
    "viral_percentage": 55, "viral_comment": "O'rtacha imkoniyat.",
    "overall_comment": "Tahlil qisman amalga oshdi.",
}

# Ishonchli baholash uchun post-processing: modelni override qilish
_SCORE_FIELDS = ("hook_score", "visual_score", "audio_score", "content_score")

# Gemini (va LLM'lar umuman) prompt qanchalik qattiq talab qilmasin, amalda
# deyarli hech qachon 1-4 oralig'ini ishlatmaydi — samarali diapazoni taxminan
# 5-9 ga siqilgan bo'lib chiqadi (real so'rovlarda tasdiqlangan: yuzlab javobda
# 1-4 deyarli umuman ko'rinmadi, 6-8 esa doim). Faqat prompt matni bilan bu
# tendensiyani to'liq yengib bo'lmadi, shuning uchun natijani DETERMINISTIK
# qayta xaritalaymiz — modelning "yumshoq" 5-9 shkalasini haqiqiy 1-10
# shkalasiga cho'zamiz. 9 va 10 (haqiqatan ajoyib deb topilgan holatlar)
# o'zgarishsiz qoladi — faqat "xavfsiz o'rtacha" hudud (4-8) pastga suriladi.
_SCORE_REMAP = {0: 0, 1: 1, 2: 1, 3: 2, 4: 3, 5: 3, 6: 4, 7: 5, 8: 7, 9: 9, 10: 10}


def _remap_score(value) -> int:
    try:
        v = max(0, min(10, int(value)))
    except (TypeError, ValueError):
        v = 5
    return _SCORE_REMAP[v]


def _sanitize(result: dict) -> dict:
    """
    Model yumshoq baho berganda tuzatish:
    - 4 ta asosiy ball _SCORE_REMAP orqali haqiqiy 1-10 shkalasiga cho'ziladi
    - viral_percentage max 88
    - remapdan keyin ham hamma 4 baho 8+ bo'lsa, eng pastini -1 qil
    """
    for f in _SCORE_FIELDS:
        if f in result:
            result[f] = _remap_score(result[f])

    # Hard cap
    if result.get("viral_percentage", 0) > 88:
        result["viral_percentage"] = 88

    # Barcha 8+ bo'lsa, eng past ballni 1 birlikga tushir
    scores = {f: result.get(f, 7) for f in _SCORE_FIELDS}
    if all(v >= 8 for v in scores.values()):
        worst = min(scores, key=scores.get)
        result[worst] = scores[worst] - 1
        log.info(f"Score sanitize: {worst} {scores[worst]}→{result[worst]}")

    return result


def _extract_json_obj(raw: str) -> dict | None:
    """Balanced-brace JSON extraction."""
    start = raw.find('{')
    if start == -1:
        return None
    depth = 0
    in_str = False
    escape = False
    for i, ch in enumerate(raw[start:], start):
        if escape:
            escape = False
            continue
        if ch == '\\' and in_str:
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except json.JSONDecodeError:
                    pass
    return None


def _regex_extract(raw: str) -> dict | None:
    int_fields = {
        "hook_score": (1, 10), "visual_score": (1, 10),
        "audio_score": (1, 10), "content_score": (1, 10),
        "viral_percentage": (0, 100),
    }
    str_fields = ["video_type", "video_type_comment", "hook_comment", "visual_comment",
                  "audio_comment", "content_comment", "viral_comment", "overall_comment"]

    result = {}
    for field, (lo, hi) in int_fields.items():
        m = re.search(rf'"{field}"\s*:\s*(\d+)', raw)
        if m:
            result[field] = max(lo, min(hi, int(m.group(1))))

    for field in str_fields:
        m = re.search(rf'"{field}"\s*:\s*"([^"{{}}]{{3,}})"', raw)
        if m:
            result[field] = m.group(1).strip()

    if len(result) >= 5:
        for k, v in DEFAULT_RESULT.items():
            result.setdefault(k, v)
        return result
    return None


def score_video(
    extracted_data: dict,
    hook_audio_b64: str | None = None,
    frames_b64: list[str] | None = None,
    lang: str = "uz",
) -> dict:
    formatted = json.dumps(extracted_data, ensure_ascii=False)
    lang_name = LANG_NAMES.get(lang, LANG_NAMES["uz"])
    prompt = (
        PROMPT_TEMPLATE
        .replace("DATA_PLACEHOLDER", formatted)
        .replace("LANG_PLACEHOLDER", lang_name)
    )

    content = []
    intro_parts = []

    # Kadrlar — video turini aniqlash uchun eng muhim signal
    if frames_b64:
        intro_parts.append(
            f"Yuqoridagi {len(frames_b64)} ta rasm — videoning boshidan oxirigacha "
            "teng oraliqda olingan HAQIQIY kadrlari (1-rasm = hook)."
        )
    if hook_audio_b64:
        intro_parts.append("Quyidagi audio — videoning birinchi 5 sekundligi (hook).")

    intro = ("\n".join(intro_parts) + "\n\n") if intro_parts else ""
    content.append({"type": "text", "text": intro + prompt})

    if frames_b64:
        for fb in frames_b64:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{fb}"},
            })

    if hook_audio_b64:
        content.append({
            "type": "input_audio",
            "input_audio": {"data": hook_audio_b64, "format": "mp3"},
        })

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [{"role": "user", "content": content}],
        "temperature": 0.15,
    }

    last_reason = "unknown"
    delay = 0
    use_fallback = False
    for attempt in range(MAX_ATTEMPTS):
        if delay:
            time.sleep(delay)
            delay = 0
        payload["model"] = OPENROUTER_FALLBACK_MODEL if use_fallback else OPENROUTER_MODEL
        try:
            resp = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=90)
            if resp.status_code != 200:
                log.error(f"OpenRouter xatolik (attempt {attempt+1}, {payload['model']}): {resp.status_code} {resp.text[:300]}")
                last_reason = str(resp.status_code)
                if resp.status_code in _FATAL_STATUSES:
                    # Pul tugagan (402) yoki kalit noto'g'ri (401/403) — qayta urinish foydasiz.
                    break
                if resp.status_code == 429 or resp.status_code >= 500:
                    # Vaqtincha (Google kvotasi band / server xatosi): kutamiz va
                    # keyingi urinishni boshqa modelda qilamiz (kvota alohida).
                    delay = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]
                    use_fallback = not use_fallback
                continue

            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            raw = ((choice.get("message") or {}).get("content") or "").strip()
            if not raw:
                log.warning(f"OpenRouter bo'sh javob (attempt {attempt+1}): {json.dumps(data)[:300]}")
                last_reason = "empty"
                continue

            raw = re.sub(r'^```(?:json)?\s*', '', raw, flags=re.MULTILINE)
            raw = re.sub(r'\s*```$', '', raw, flags=re.MULTILINE)
            raw = raw.strip()
            log.info(f"OpenRouter (attempt {attempt+1}, {payload['model']}): {raw[:300]}")

            parsed = _extract_json_obj(raw)
            if parsed:
                return _sanitize(parsed)

            try:
                return _sanitize(json.loads(raw))
            except json.JSONDecodeError:
                pass

            extracted = _regex_extract(raw)
            if extracted:
                log.info("Regex fallback ishlatildi")
                return _sanitize(extracted)

            log.warning(f"Attempt {attempt+1}: parse muvaffaqiyatsiz")
            last_reason = "parse"

        except requests.RequestException as e:
            log.error(f"OpenRouter so'rov xatolik (attempt {attempt+1}): {e}")
            last_reason = "network"
            delay = _RETRY_DELAYS[min(attempt, len(_RETRY_DELAYS) - 1)]

    # Barcha urinishlar muvaffaqiyatsiz — chaqiruvchi (_process_video) buni
    # "_fallback" belgisidan aniqlaydi. Sabab kodi (_fallback_reason) bo'yicha:
    # 401/402/403 — xizmat o'chiriladi; vaqtincha xato (429/5xx/tarmoq) — faqat
    # foydalanuvchiga "qayta yuboring" deyiladi. Belgilar formatlashdan oldin
    # olib tashlanadi (foydalanuvchiga ko'rinmaydi).
    result = DEFAULT_RESULT.copy()
    result["_fallback"] = True
    result["_fallback_reason"] = last_reason
    return result
