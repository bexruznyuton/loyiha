"""
FastAPI HTTP endpoint — PHP bot (instacap) dan video tahlil so'rovlarini qabul qiladi.

Oqim:
  PHP → POST /analyze {file_id, chat_id, user_id, status_mid, request_id, expires_at, sig}
  Python → Pyrogram (MTProto) orqali video yuklab olish → tahlil → Telegram ga natija yuborish
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from collections import defaultdict
from threading import Event, Lock, Thread

import requests
import uvicorn
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from pydantic import BaseModel
from pyrogram import Client as PyroClient

from config import (
    BOT_PHP_FORWARD_SECRET,
    BOT_PHP_RELAY_URL,
    BOT_TOKEN,
    OPENROUTER_API_KEY,
    TELEGRAM_API_HASH,
    TELEGRAM_API_ID,
    TEMP_DIR,
)
from services.ai_scorer import score_video
from services.formatter import format_analysis
from services.users import (
    get_or_create_user,
    get_last_viral_percentage,
    has_used_today,
    increment_analysis_count,
    update_viral_percentage,
)
from services.video_extractor import extract_all, extract_frames_b64, extract_hook_audio_b64

log = logging.getLogger(__name__)

VIDOCTOR_SECRET = os.getenv("VIDOCTOR_SECRET", "CHANGE_ME")
# Vaqtinchalik: imzo mos kelmaganda ham so'rovni bajarish (host↔VPS secret nomuvofiqligi)
SIG_SOFT = os.getenv("SIG_SOFT", "0") == "1"
API_PORT        = int(os.getenv("ANALYZER_PORT", "8765"))
MAX_FILE_MB     = 50
MAX_EXPIRE_SECS = 300
RATE_WINDOW     = 60
RATE_LIMIT      = 3

# Adminlar — kunlik limitdan ozod
ADMIN_IDS: set[int] = {
    int(x.strip()) for x in os.getenv("ADMIN_IDS", "0").split(",") if x.strip()
}

# ── AI fallback (DEFAULT_RESULT/30%) kuzatuvi ──────────────────────────────
# ai_scorer.score_video() 3 urinishda ham muvaffaqiyatsiz bo'lsa (masalan
# OpenRouter balansi tugasa), foydalanuvchiga soxta 30% natija ketadi. Buni
# birinchi bor payqaganda: (1) adminlarga balans bilan birga xabar beramiz,
# (2) bot.php dagi "🎥 Video analiz sozlama" bayrog'ini o'chirib qo'yamiz —
# shu bilan yangi so'rovlar VPS'ga umuman yuborilmay, tushunarli xabar bilan
# to'xtaydi. Qayta-qayta spam bo'lmasligi uchun cooldown bilan cheklaymiz.
FALLBACK_STATE_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fallback_alert_state.json"
)
FALLBACK_ALERT_COOLDOWN = 1800  # 30 daqiqa — shundan tez-tez qayta ogohlantirmaydi
_fallback_lock = Lock()


def _get_openrouter_balance() -> float | None:
    try:
        r = requests.get(
            "https://openrouter.ai/api/v1/credits",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            timeout=10,
        )
        d = r.json().get("data", {})
        return round(float(d.get("total_credits", 0)) - float(d.get("total_usage", 0)), 4)
    except Exception as e:
        log.error(f"OpenRouter balans olishda xatolik: {e}")
        return None


def _disable_video_analiz_via_botphp():
    try:
        requests.post(
            f"{BOT_PHP_RELAY_URL}?relay=video_analiz_off",
            headers={"X-Forward-Secret": BOT_PHP_FORWARD_SECRET, "Content-Type": "application/json"},
            json={},
            timeout=10,
        )
        log.warning("Video analiz bot.php orqali AVTOMATIK o'chirildi (AI fallback tufayli)")
    except Exception as e:
        log.error(f"video_analiz_off relay xatolik: {e}")


def _handle_ai_fallback_detected(reason: str = "unknown"):
    """AI barcha urinishda javob bermaganda chaqiriladi. Cooldown ichida bo'lsa jim turadi.

    Sabab kodi bo'yicha: 401/402/403 (pul tugagan / kalit noto'g'ri) — admin'ga xabar VA
    xizmat avtomatik o'chiriladi. Vaqtincha xato (429/5xx/tarmoq) — faqat admin'ga
    ma'lumot, xizmat O'CHIRILMAYDI."""
    fatal = reason in ("401", "402", "403")
    key = "last_alert_ts_fatal" if fatal else "last_alert_ts_transient"
    with _fallback_lock:
        try:
            with open(FALLBACK_STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
        except Exception:
            state = {}
        now = time.time()
        if now - state.get(key, 0) < FALLBACK_ALERT_COOLDOWN:
            return
        state[key] = now
        try:
            with open(FALLBACK_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(state, f)
        except Exception as e:
            log.error(f"fallback_alert_state yozishda xatolik: {e}")

    balance = _get_openrouter_balance()
    bal_txt = f"${balance:.4f}" if balance is not None else "aniqlanmadi (xatolik)"
    reason_txt = {
        "401": "401 — OpenRouter kaliti noto'g'ri/bekor qilingan",
        "403": "403 — kalitga ruxsat yo'q",
        "402": "402 — OpenRouter balansi tugagan",
        "429": "429 — Google kvotasi vaqtincha band (rate limit)",
        "network": "tarmoq/ulanish xatosi",
        "empty": "AI bo'sh javob qaytardi",
        "parse": "AI javobini o'qib bo'lmadi",
    }.get(reason, f"{reason}")
    if fatal:
        text = (
            "⚠️ <b>Video tahlil to'xtadi!</b>\n\n"
            f"❗ Sabab: <b>{reason_txt}</b>\n"
            f"💰 <b>OpenRouter balans:</b> {bal_txt}\n\n"
            "🛑 Video tahlil <b>avtomatik o'chirildi</b> "
            "(admin panel: 🎥 Video analiz sozlama).\n"
            "Muammoni (balans/kalit) hal qilib, admin paneldan qo'lda qayta yoqing."
        )
    else:
        text = (
            "⚠️ <b>AI vaqtincha javob bermayapti</b>\n\n"
            f"❗ Sabab: <b>{reason_txt}</b>\n"
            f"💰 OpenRouter balans: {bal_txt}\n\n"
            "Zaxira modelga ham o'tib ko'rildi. Foydalanuvchilarga "
            "\"bir daqiqadan keyin qayta yuboring\" deyildi (limit sarflanmadi). "
            "Xizmat <b>o'chirilmadi</b>."
        )
    for admin_id in ADMIN_IDS:
        _tg_send(admin_id, text)
    if fatal:
        _disable_video_analiz_via_botphp()

# Video tahlil statistikasi — Innsy bot (instacap) o'qiydi
VIDEO_ANALYTICS_FILE = os.getenv(
    "VIDEO_ANALYTICS_FILE",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "video_analytics.json"),
)
_analytics_lock = Lock()

# Kunlik limit sozlamasi — Innsy bot admin paneli yozadi, shu yerda o'qiladi
VIDEO_LIMIT_CONFIG = os.getenv(
    "VIDEO_LIMIT_CONFIG",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "limit_config.json"),
)
_TASHKENT_OFFSET = 5 * 3600

# "Kuchli tahlil" — AI'ga standart kadr sonining 2 barobari yuboriladi
# (extract_frames_b64'ning o'z ichki standart qiymati bilan mos, shu yerda
# aniq ko'rsatilgan — kelajakda ikkalasi mustaqil o'zgarishi mumkin).
FRAME_COUNT_NORMAL = 4
FRAME_COUNT_STRONG = FRAME_COUNT_NORMAL * 2


def _daily_limit() -> int:
    """Joriy kunlik limit. 0 = cheksiz. Fayl bo'lmasa standart 1."""
    try:
        with open(VIDEO_LIMIT_CONFIG, "r", encoding="utf-8") as f:
            return int(json.load(f).get("daily_limit", 1))
    except Exception:
        return 1


def _tashkent_day_start_ms() -> int:
    day = int((time.time() + _TASHKENT_OFFSET) // 86400)
    return int((day * 86400 - _TASHKENT_OFFSET) * 1000)


def _usage_counts(user_id: int) -> tuple[int, int]:
    """(bugungi jami sarflangan bepul/referral limit, umrbod pullik pooldan
    sarflangan limit) — bitta o'qishda. "Kuchli tahlil" (event'da strong=True)
    BU HISOBGA UMUMAN KIRMAYDI — u alohida, har safar naqd to'lanadigan mahsulot,
    kunlik limit/referral/pullik pool bilan aloqasi yo'q (aks holda uni sotib
    olgan odam shu hisobdan navbatdagi ODDIY tahlili uchun limitini "yeb qo'ygan"
    bo'lib chiqardi)."""
    try:
        with _analytics_lock:
            if not os.path.exists(VIDEO_ANALYTICS_FILE):
                return 0, 0
            with open(VIDEO_ANALYTICS_FILE, "r", encoding="utf-8") as f:
                events = json.load(f).get("events", [])
        start = _tashkent_day_start_ms()
        uid = str(user_id)
        today = 0
        paid = 0
        for e in events:
            if e.get("type") != "video_analyzed" or e.get("userId") != uid:
                continue
            if e.get("strong"):
                continue
            if e.get("timestamp", 0) >= start:
                today += 1
            if e.get("paid"):
                paid += 1
        return today, paid
    except Exception as e:
        log.warning(f"usage_counts xatolik: {e}")
        return 0, 0


def _used_today_count(user_id: int) -> int:
    return _usage_counts(user_id)[0]


def _track_analysis(user_id: int | None, viral_p: int, paid: bool = False, strong: bool = False) -> None:
    """Har muvaffaqiyatli tahlilni timestamp bilan JSON faylga yozadi.
    paid=True — bepul kunlik limitdan tashqari, sotib olingan pooldan sarflangan.
    strong=True — "Kuchli tahlil" (har safar alohida to'langan, pool'ga
    umuman kirmaydi — _usage_counts buni o'tkazib yuboradi)."""
    try:
        with _analytics_lock:
            data = {"events": []}
            if os.path.exists(VIDEO_ANALYTICS_FILE):
                try:
                    with open(VIDEO_ANALYTICS_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                except (json.JSONDecodeError, OSError):
                    data = {"events": []}
            ev = {
                "timestamp": int(time.time() * 1000),
                "type": "video_analyzed",
                "userId": str(user_id) if user_id else "",
                "viral": viral_p,
            }
            if paid:
                ev["paid"] = True
            if strong:
                ev["strong"] = True
            data.setdefault("events", []).append(ev)
            # Fayl cheksiz o'smasin
            if len(data["events"]) > 50000:
                data["events"] = data["events"][-50000:]
            with open(VIDEO_ANALYTICS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
    except Exception as e:
        log.warning(f"video analytics yozishda xatolik: {e}")

TG_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# "⏳" xabarini yuborgan instacap bot tokeni — Telegram faqat xabar yuborgan bot edit qila oladi
INSTACAP_BOT_TOKEN = os.getenv("INSTACAP_BOT_TOKEN", "CHANGE_ME")
TG_API_INSTACAP = f"https://api.telegram.org/bot{INSTACAP_BOT_TOKEN}"

api = FastAPI(title="VIDoctorai Analyzer API", docs_url=None, redoc_url=None)

# Takrorlanishdan himoya (replay attack)
_seen_requests: dict[str, float] = {}
_seen_lock = Lock()

# Rate limiting: {chat_id: [timestamp, ...]}
_rate_map: dict[int, list] = defaultdict(list)
_rate_lock = Lock()

# Jarayondagi (hali tugamagan) tahlillar — kunlik limit poygasini yopadi.
# Statistikaga yozuv tahlil TUGAGACH tushadi; foydalanuvchi ketma-ket bir
# nechta video tashlasa, hammasi tekshiruvdan o'tib ketmasligi uchun
# tekshiruv paytidayoq joy band qilinadi.
_inflight: dict[int, int] = defaultdict(int)         # jarayondagi barcha tahlillar
_inflight_paid: dict[int, int] = defaultdict(int)    # jarayondagi PULLIK tahlillar
_inflight_lock = Lock()


class AnalyzeRequest(BaseModel):
    file_id: str
    message_id: int
    chat_id: int
    user_id: int | None = None
    status_mid: int | None = None
    request_id: str
    expires_at: int
    lang: str = "uz"
    extra_limit: int = 0  # referal bonusi (kunlik bepul limitga qo'shiladi)
    paid_limit: int = 0   # sotib olingan jami pullik limit (kumulyativ pool)
    vip: int = 0          # 1 = amaldagi VIP obuna → kunlik limit tekshirilmaydi
    strong: int = 0       # 1 = "Kuchli tahlil" — 2x kadr AI'ga, 2x limit sarflanadi
    sig: str


# Bot tiliga mos xizmat xabarlari
MSG_L10N = {
    "uz": {
        "stage_receive": "📥 Videoni qabul qilyapman...",
        "stage_inspect": "🔍 Videoni o'rganyapman...",
        "stage_audio":   "🎧 Audioni tinglayapman...",
        "stage_frames":  "🎬 Kadrlarni kuzatyapman...",
        "stage_ai":      "🧠 Videoni baholayapman...",
        "stage_ai_hook": "🎣 Hookni aniqlayapman...",
        "stage_ai_compare": "🔎 O'xshash kontentlar bilan solishtiryapman...",
        "elapsed":       "soniya o'tdi",
        "limit": ("⏰ <b>Kunlik limitingiz tugadi.</b>\n\n"
                  "Har bir foydalanuvchiga kuniga <b>{n} ta</b> bepul tahlil beriladi.\n\n"
                  "💎 <b>Kutmasdan davom etmoqchimisiz?</b>\n"
                  "Pastdagi tugma orqali qo'shimcha tahlil limiti sotib oling — darhol ishlaydi!"),
        "too_big": "⚠️ Video hajmi juda katta ({mb} MB). Maksimal: {max} MB.",
        "error":   "❌ Tahlil vaqtincha ishlamadi. Iltimos, qayta urinib ko'ring.",
        "busy":    "⏳ Sun'iy intellekt hozir band. Iltimos, bir daqiqadan keyin videoni qayta yuboring — limitingiz sarflanmadi.",
        "rate":    "⚠️ Juda ko'p so'rov. 1 daqiqa kutib, qayta urinib ko'ring.",
        "buy_btn": "💎 Limit sotib olish",
    },
    "ru": {
        "stage_receive": "📥 Получаю видео...",
        "stage_inspect": "🔍 Изучаю видео...",
        "stage_audio":   "🎧 Слушаю аудио...",
        "stage_frames":  "🎬 Просматриваю кадры...",
        "stage_ai":      "🧠 Оцениваю видео...",
        "stage_ai_hook": "🎣 Определяю хук...",
        "stage_ai_compare": "🔎 Сравниваю с похожим контентом...",
        "elapsed":       "секунд прошло",
        "limit": ("⏰ <b>Дневной лимит исчерпан.</b>\n\n"
                  "Каждому пользователю даётся <b>{n}</b> бесплатных анализов в день.\n\n"
                  "💎 <b>Не хотите ждать?</b>\n"
                  "Купите дополнительный лимит анализов по кнопке ниже — работает сразу!"),
        "too_big": "⚠️ Видео слишком большое ({mb} MB). Максимум: {max} MB.",
        "error":   "❌ Анализ временно недоступен. Пожалуйста, попробуйте ещё раз.",
        "busy":    "⏳ ИИ сейчас перегружен. Пожалуйста, отправьте видео ещё раз через минуту — лимит не потрачен.",
        "rate":    "⚠️ Слишком много запросов. Подождите 1 минуту и попробуйте снова.",
        "buy_btn": "💎 Купить лимит",
    },
    "en": {
        "stage_receive": "📥 Receiving the video...",
        "stage_inspect": "🔍 Inspecting the video...",
        "stage_audio":   "🎧 Listening to the audio...",
        "stage_frames":  "🎬 Reviewing the frames...",
        "stage_ai":      "🧠 Scoring the video...",
        "stage_ai_hook": "🎣 Identifying the hook...",
        "stage_ai_compare": "🔎 Comparing with similar content...",
        "elapsed":       "seconds elapsed",
        "limit": ("⏰ <b>Your daily limit is used up.</b>\n\n"
                  "Each user gets <b>{n}</b> free analyses per day.\n\n"
                  "💎 <b>Don't want to wait?</b>\n"
                  "Buy extra analysis limit with the button below — works instantly!"),
        "too_big": "⚠️ Video is too large ({mb} MB). Maximum: {max} MB.",
        "error":   "❌ Analysis is temporarily unavailable. Please try again.",
        "busy":    "⏳ The AI is busy right now. Please send the video again in a minute — your limit was not used.",
        "rate":    "⚠️ Too many requests. Wait 1 minute and try again.",
        "buy_btn": "💎 Buy limit",
    },
}


def _msgs(lang: str) -> dict:
    return MSG_L10N.get(lang, MSG_L10N["uz"])


# Asosiy menyu — bot.php dagi getMenu() bilan BIR XIL bo'lishi shart
# (ikkinchi/tinchlanish qatordagi tugma matnlari va ikonkalari).
_MENU_ICONS = {
    "tag": "5987802868734760945",
    "video": "6005986106703613755",
    "bookmark": "5899757765743615694",
    "chart": "5875431869842985304",
    "language": "5879585266426973039",
}

_MENU_LABELS = {
    "uz": {"heshteglar": "Heshteglar", "video_analiz": "Video analiz", "heshteg_olish": "Heshteg yuklash", "algoritm": "ALGORITM", "til": "Til"},
    "ru": {"heshteglar": "Хэштеги", "video_analiz": "Видео анализ", "heshteg_olish": "Загрузить хэштег", "algoritm": "АЛГОРИТМ", "til": "Язык"},
    "en": {"heshteglar": "Hashtags", "video_analiz": "Video analysis", "heshteg_olish": "Download hashtag", "algoritm": "ALGORITHM", "til": "Language"},
}


def _menu_button(text: str, icon_key: str, style: str | None = None) -> dict:
    btn = {"text": text, "icon_custom_emoji_id": _MENU_ICONS[icon_key]}
    if style:
        btn["style"] = style
    return btn


def _main_menu_keyboard(lang: str) -> dict:
    labels = _MENU_LABELS.get(lang, _MENU_LABELS["uz"])
    return {
        "resize_keyboard": True,
        "keyboard": [
            [_menu_button(labels["heshteglar"], "tag")],
            [_menu_button(labels["video_analiz"], "video", "danger"), _menu_button(labels["heshteg_olish"], "bookmark", "success")],
            [_menu_button(labels["algoritm"], "chart"), _menu_button(labels["til"], "language")],
        ],
    }


def _verify_sig(req: AnalyzeRequest) -> bool:
    base = (
        f"fid:{req.file_id}:mid:{req.message_id}:chat:{req.chat_id}"
        f":req:{req.request_id}:exp:{req.expires_at}"
    )
    def _match(msg: str) -> bool:
        expected = hmac.new(VIDOCTOR_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, req.sig)

    # 1) Joriy format — vip VA strong bayroqlari IMZOGA kiritilgan. Ikkalasi
    #    ham FAQAT shu yo'l bilan tasdiqlanadi (soxtalashtirib bo'lmaydi) —
    #    "strong" 2x limit sarflashini bildiradi, imzosiz forge qilinsa
    #    foydalanuvchi 1x narxga 2x kadr olib qolishi mumkin edi.
    if _match(f"{base}:xlim:{req.extra_limit}:plim:{req.paid_limit}:vip:{req.vip}:strong:{req.strong}"):
        return True

    # 2) Eski formatlar — orqaga moslik (bot.php hali yangilanmagan bo'lsa).
    #    Bu imzolar vip/strong da'vosini QAMRAMAYDI, shuning uchun ular bilan
    #    kelgan har qanday vip=1/strong=1 da'vosini bekor qilamiz (0 ga
    #    majburlaymiz). Aks holda eski formatdagi imzoga vip=1 yoki strong=1
    #    qo'shib cheksiz/chegirmasiz kuchli tahlil olish mumkin edi.
    for msg in (
        f"{base}:xlim:{req.extra_limit}:plim:{req.paid_limit}:vip:{req.vip}",
        f"{base}:xlim:{req.extra_limit}:plim:{req.paid_limit}",
        f"{base}:xlim:{req.extra_limit}",
        base,
    ):
        if _match(msg):
            if req.vip:
                log.warning(f"Imzolanmagan VIP da'vosi bekor qilindi: chat={req.chat_id}")
            if req.strong:
                log.warning(f"Imzolanmagan 'Kuchli tahlil' da'vosi bekor qilindi: chat={req.chat_id}")
            req.vip = 0
            req.strong = 0
            return True
    return False


def _check_replay(req_id: str) -> bool:
    """True = yangi, False = takror (replay attack)."""
    now = time.time()
    with _seen_lock:
        # Eskiganlarni tozala
        expired = [k for k, t in _seen_requests.items() if now - t > MAX_EXPIRE_SECS * 2]
        for k in expired:
            del _seen_requests[k]
        if req_id in _seen_requests:
            return False
        _seen_requests[req_id] = now
        return True


def _check_rate(chat_id: int) -> bool:
    """True = OK, False = limit oshdi."""
    now = time.time()
    with _rate_lock:
        ts = _rate_map[chat_id]
        ts[:] = [t for t in ts if now - t < RATE_WINDOW]
        if len(ts) >= RATE_LIMIT:
            return False
        ts.append(now)
        return True


def _tg_send(chat_id: int, text: str, parse_mode: str = "HTML", reply_markup: dict | None = None) -> dict:
    # instacap bot orqali — foydalanuvchi shu bot bilan gaplashadi
    try:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        r = requests.post(
            f"{TG_API_INSTACAP}/sendMessage",
            json=payload,
            timeout=10,
        )
        return r.json()
    except Exception as e:
        log.error(f"tg_send error: {e}")
        return {}


def _tg_edit(chat_id: int, message_id: int, text: str, parse_mode: str = "HTML", reply_markup: dict | None = None) -> bool:
    try:
        payload = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": parse_mode,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        r = requests.post(
            f"{TG_API_INSTACAP}/editMessageText",
            json=payload,
            timeout=10,
        )
        return r.json().get("ok", False)
    except Exception as e:
        log.error(f"tg_edit error: {e}")
        return False


def _tg_delete(chat_id: int, message_id: int) -> bool:
    # "processing" xabarini o'chirish. PHP uni reply-keyboard bilan yuboradi,
    # shuning uchun uni edit qilib bo'lmaydi ("message can't be edited") —
    # o'rniga o'chirib, yangi (natija/limit) xabarini yuboramiz.
    try:
        r = requests.post(
            f"{TG_API_INSTACAP}/deleteMessage",
            json={"chat_id": chat_id, "message_id": message_id},
            timeout=10,
        )
        return r.json().get("ok", False)
    except Exception as e:
        log.error(f"tg_delete error: {e}")
        return False


def _progress_updater(chat_id: int, status_mid: int, state: dict, stop: Event):
    """
    Status xabarini joriy bosqich bilan yangilab turadi (nuqtali progress-bar
    olib tashlangan — faqat matn). state["stage"] — _process_video tomonidan
    bosqichma-bosqich o'zgartiriladi; bitta satr (string) yoki bir nechta
    matn orasida aylanadigan ro'yxat (list) bo'lishi mumkin — masalan AI
    bosqichida "baholayapman" / "hookni aniqlayapman" / "o'xshash kontentlar
    bilan solishtiryapman" orasida aylanadi (haqiqiy sub-bosqich emas, lekin
    foydalanuvchiga jarayon davom etayotganini his qildiradi).
    """
    i = 0
    while not stop.is_set():
        # Yozishdan oldin yana tekshiramiz — asosiy thread natijani yozgan
        # bo'lishi mumkin (race condition oldini olish)
        if stop.is_set():
            break
        stage = state.get('stage', '⏳ ...')
        text = stage[i % len(stage)] if isinstance(stage, list) else stage
        ok = _tg_edit(chat_id, status_mid, text)
        if not ok and not state.get("edit_fail_logged"):
            # Faqat bir marta logga yozamiz (spam bo'lmasin) — sabab odatda
            # status xabarda reply_markup borligi (bot.php eski versiyasi).
            state["edit_fail_logged"] = True
            log.warning(f"Progress edit muvaffaqiyatsiz (loader ko'rinmaydi): chat={chat_id} status_mid={status_mid}")
        i += 1
        if stop.wait(2.5):
            break


# Doimiy Pyrogram klienti — har so'rovda qayta avtorizatsiya qilinmaydi.
# Sessiya diskda saqlanadi (instacap_dl.session), restartdan keyin ham
# auth.ImportBotAuthorization chaqirilmaydi — FloodWait oldini oladi.
_pyro_client: PyroClient | None = None
_pyro_client_lock = Lock()
_PYRO_WORKDIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _get_pyro_client() -> PyroClient:
    global _pyro_client
    with _pyro_client_lock:
        if _pyro_client is None:
            _pyro_client = PyroClient(
                "instacap_dl",
                api_id=TELEGRAM_API_ID,
                api_hash=TELEGRAM_API_HASH,
                bot_token=INSTACAP_BOT_TOKEN,
                no_updates=True,
                workdir=_PYRO_WORKDIR,
            )
        return _pyro_client


async def _pyro_download(chat_id: int, message_id: int, dest: str):
    """
    Video instacap botga yuborilgan — shu bot tokeni bilan ulanish SHART.
    file_id dagi file_reference eskiradi, shuning uchun get_messages()
    bilan yangi Message obyekt olib, undan yuklab olamiz.
    """
    client = _get_pyro_client()
    if not client.is_connected:
        try:
            await client.start()
        except ConnectionError:
            pass  # boshqa oqim allaqachon ulagan
    msg = await client.get_messages(chat_id, message_id)
    if not msg or (not msg.video and not msg.document):
        raise ValueError(f"Xabarda video topilmadi: chat={chat_id} mid={message_id}")
    await client.download_media(msg, file_name=dest)


def _process_video(req: AnalyzeRequest):
    chat_id = req.chat_id
    user_id = req.user_id
    status_mid = req.status_mid
    lang = req.lang if req.lang in MSG_L10N else "uz"
    m = _msgs(lang)

    video_path = os.path.join(TEMP_DIR, f"ext_{req.request_id}.mp4")
    progress_stop = Event()
    inflight_user = None
    is_paid = False  # bu tahlil pullik pooldan sarflandimi
    try:
        # Limit tekshiruvi (adminlar VA 👑 VIP obunachilar uchun o'tkazib yuboriladi).
        #   VIP (req.vip=1) — cheksiz tahlil; bayroq HMAC imzosiga kiritilgan,
        #   shuning uchun uni soxtalashtirib bo'lmaydi.
        #   Bepul kunlik allowance = bazaviy limit (Innsy bot) + referal bonusi.
        #   Bepul tugasa — sotib olingan pullik pooldan sarflanadi (kumulyativ).
        #   Tugallangan + jarayondagi tahlillar birga sanaladi (poyga yopilgan).
        # "Kuchli tahlil" (req.strong) — bepul kunlik limit/referral bonusi/
        # sotib olingan pooldan HECH QACHON foydalanmaydi. bot.php step'ni
        # "video_analiz_strong"ga FAQAT checkout.uz orqali alohida to'lov
        # muvaffaqiyatli bo'lgandan keyin o'rnatadi (createStrongAnalysisPayment/
        # creditPaymentOnce) — shuning uchun bu yerga strong=1 bilan so'rov
        # kelgan payt to'lov ALLAQACHON amalga oshgan, pool tekshiruvi shart
        # emas (xuddi VIP kabi o'tkazib yuboriladi, lekin VIP'dan farqli
        # o'laroq bu HAR SAFAR pul evaziga, cheksiz obuna emas).
        if user_id and user_id not in ADMIN_IDS and not req.vip and not req.strong:
            try:
                get_or_create_user(user_id, None)
                base_limit = _daily_limit()
                if base_limit > 0:
                    free_allow = base_limit + max(0, req.extra_limit)
                    paid_pool  = max(0, req.paid_limit)
                    over = False
                    with _inflight_lock:
                        used_today, paid_used = _usage_counts(user_id)
                        if used_today + _inflight[user_id] < free_allow:
                            # bepul joy bor
                            _inflight[user_id] += 1
                            inflight_user = user_id
                        elif paid_used + _inflight_paid[user_id] < paid_pool:
                            # bepul tugadi — pullik pooldan sarflaymiz
                            _inflight[user_id] += 1
                            _inflight_paid[user_id] += 1
                            inflight_user = user_id
                            is_paid = True
                        else:
                            over = True
                    if over:
                        msg = m["limit"].format(n=free_allow)
                        # "Limit sotib olish" tugmasi — bot.php dagi buylimit oqimini
                        # ochadi (checkout.uz orqali Click/Payme to'lovi).
                        buy_kb = {"inline_keyboard": [[
                            {"text": m["buy_btn"], "callback_data": "buylimit"}
                        ]]}
                        # "processing" xabarini joyida limit xabariga aylantiramiz.
                        # Agar u reply-keyboard bilan yuborilgan bo'lsa, Telegram
                        # edit'ga ruxsat bermaydi ("message can't be edited") —
                        # o'shanda uni o'chirib, yangi xabar yuboramiz. Har ikki
                        # holatda ham foydalanuvchi FAQAT bitta xabar ko'radi.
                        ok = False
                        if status_mid:
                            ok = _tg_edit(chat_id, status_mid, msg, reply_markup=buy_kb)
                        if not ok:
                            if status_mid:
                                _tg_delete(chat_id, status_mid)
                            _tg_send(chat_id, msg, reply_markup=buy_kb)
                        log.info(f"Limit tugadi: chat={chat_id} user={user_id} "
                                 f"free={free_allow}(baza{base_limit}+ref{req.extra_limit}) "
                                 f"paid_used={paid_used}/{paid_pool}")
                        return
            except Exception as e:
                log.warning(f"Limit tekshiruv xatolik (user={user_id}): {e}")

        # Jonli progress: status xabari bosqichma-bosqich yangilanadi
        progress_state = {"stage": m["stage_receive"]}
        progress_thread = None
        if status_mid:
            progress_thread = Thread(
                target=_progress_updater,
                args=(chat_id, status_mid, progress_state, progress_stop),
                daemon=True,
            )
            progress_thread.start()

        # Video yuklab olish (Pyrogram MTProto — 50MB+ ishlaydi)
        log.info(f"Video yuklanmoqda (MTProto): chat={chat_id} mid={req.message_id}")
        asyncio.run(_pyro_download(chat_id, req.message_id, video_path))

        if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
            raise ValueError("Video yuklab olinmadi (0 bayt) — tahlil to'xtatildi")

        file_mb = os.path.getsize(video_path) / (1024 * 1024)
        log.info(f"Yuklab olindi: {file_mb:.1f} MB")

        if file_mb > MAX_FILE_MB:
            progress_stop.set()
            _tg_send(chat_id, m["too_big"].format(mb=f"{file_mb:.0f}", max=MAX_FILE_MB))
            return

        # Oldingi natija
        previous_viral = None
        if user_id:
            try:
                get_or_create_user(user_id, None)
                previous_viral = get_last_viral_percentage(user_id)
            except Exception:
                pass

        # Tahlil
        log.info(f"Tahlil boshlanmoqda: chat={chat_id}")
        progress_state["stage"] = m["stage_inspect"]
        data = extract_all(video_path)

        progress_state["stage"] = m["stage_audio"]
        hook_audio = extract_hook_audio_b64(video_path)

        progress_state["stage"] = m["stage_frames"]
        # "Kuchli tahlil" — standart kadr sonining 2 barobari AI'ga yuboriladi
        # (tahlil sifati/aniqligi oshsin uchun — bu bot.php tomonidan alohida
        # to'lov evaziga beriladi, kunlik limit bilan aloqasi yo'q).
        frame_count = FRAME_COUNT_STRONG if req.strong else FRAME_COUNT_NORMAL
        frames = extract_frames_b64(video_path, count=frame_count)
        log.info(f"Kadrlar chiqarildi: {len(frames)} ta (strong={req.strong})")

        # AI bosqichi odatda eng uzoq davom etadigan qism — foydalanuvchi
        # bir xil matnni ko'rib zerikmasligi uchun bir nechta matn orasida
        # aylanadi (_progress_updater shu ro'yxatni ~2.5s'da bittadan ko'rsatadi).
        progress_state["stage"] = [m["stage_ai"], m["stage_ai_hook"], m["stage_ai_compare"]]
        result = score_video(data, hook_audio, frames, lang)

        # AI 3 urinishda ham javob bermagan (DEFAULT_RESULT/30% fallback) —
        # adminlarga xabar beramiz va video tahlilni avtomatik o'chiramiz.
        # Belgi foydalanuvchiga ko'rinmasin deb formatlashdan oldin olib tashlanadi.
        if result.pop("_fallback", False):
            reason = str(result.pop("_fallback_reason", "unknown"))
            _handle_ai_fallback_detected(reason)
            # Soxta 30% natija YUBORILMAYDI va tahlil limitdan sanalmaydi:
            # foydalanuvchiga "qayta yuboring" deyiladi.
            progress_stop.set()
            if progress_thread is not None:
                progress_thread.join(timeout=12)
            if status_mid:
                _tg_delete(chat_id, status_mid)
            _tg_send(chat_id, m["busy"], reply_markup=_main_menu_keyboard(lang))
            return

        # Rekga chiqish imkoniyatini 25 foiz punktga kamaytiramiz (real, kamtarin baho) —
        # foydalanuvchiga ko'rsatiladigan, DB va statistikaga yoziladigan yagona qiymat
        try:
            raw_viral = int(result.get("viral_percentage", 0))
        except (TypeError, ValueError):
            raw_viral = 0
        result["viral_percentage"] = max(0, raw_viral - 25)

        viral_p = result.get("viral_percentage", 0)
        text = format_analysis(result, previous_viral=previous_viral, lang=lang)

        # Progress to'xtatiladi va thread to'liq tugashini kutamiz —
        # aks holda progress bar natija ustidan yozib yuborishi mumkin (race)
        progress_stop.set()
        if progress_thread is not None:
            progress_thread.join(timeout=12)
        # Natija ATAYLAB edit emas, YANGI xabar sifatida yuboriladi: shu bilan
        # reply_markup (asosiy menyu) natija bilan birga darhol o'rnatiladi —
        # editMessageText orqali ReplyKeyboardMarkup o'rnatib bo'lmaydi.
        if status_mid:
            _tg_delete(chat_id, status_mid)
        _tg_send(chat_id, text, reply_markup=_main_menu_keyboard(lang))

        # DB yangilash
        if user_id:
            try:
                increment_analysis_count(user_id)
                update_viral_percentage(user_id, viral_p)
            except Exception:
                pass

        # Statistika (Innsy bot uchun) — pullik pooldan bo'lsa paid=True,
        # "Kuchli tahlil" bo'lsa strong=True yoziladi (bu holatda _usage_counts
        # buni kunlik/pullik pool hisobiga umuman qo'shmaydi).
        _track_analysis(user_id, viral_p, paid=is_paid, strong=bool(req.strong))

        log.info(f"Tahlil tugadi: chat={chat_id}, viral={viral_p}%")

    except Exception as e:
        log.exception(f"Tahlil xatosi: {e}")
        _tg_send(chat_id, m["error"])
    finally:
        progress_stop.set()
        if inflight_user is not None:
            with _inflight_lock:
                _inflight[inflight_user] = max(0, _inflight[inflight_user] - 1)
                if is_paid:
                    _inflight_paid[inflight_user] = max(0, _inflight_paid[inflight_user] - 1)
        if os.path.exists(video_path):
            os.remove(video_path)


@api.post("/analyze")
async def analyze(req: AnalyzeRequest, background_tasks: BackgroundTasks):
    # 1. HMAC imzo tekshiruvi.
    # SIG_SOFT=1 — vaqtinchalik: imzo mos kelmasa ham davom etadi (host↔VPS
    # secret nomuvofiqligi paytida xizmatni tiklab turish uchun). Boshqa
    # himoyalar (muddat, replay, rate-limit) saqlanadi.
    if not _verify_sig(req):
        if SIG_SOFT:
            log.warning(f"Imzo mos emas (SOFT rejim — o'tkazildi): chat={req.chat_id} req={req.request_id}")
        else:
            log.warning(f"Noto'g'ri imzo: chat={req.chat_id} req={req.request_id}")
            raise HTTPException(status_code=403, detail="Invalid signature")

    # 2. Muddat tekshiruvi
    if time.time() > req.expires_at:
        raise HTTPException(status_code=410, detail="Request expired")

    # 3. Replay attack himoyasi
    if not _check_replay(req.request_id):
        raise HTTPException(status_code=409, detail="Duplicate request")

    # 4. Rate limiting (user boshiga)
    if not _check_rate(req.chat_id):
        _tg_send(req.chat_id, _msgs(req.lang)["rate"])
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    # Fon jarayonida ishlat (PHP 5s kutadi, keyin davom etadi)
    background_tasks.add_task(_process_video, req)
    return {"status": "queued", "request_id": req.request_id}


@api.get("/health")
async def health():
    return {"status": "ok", "service": "vidoctorai-analyzer"}


@api.get("/admin/balance")
async def admin_balance(request: Request):
    # Xavfsizlik: bot.php'ga OPENROUTER_API_KEY (pul sarflay oladigan kalit)
    # HECH QACHON berilmaydi — u faqat shu VPS'da qoladi. bot.php faqat
    # allaqachon ikkala tomonda mavjud VIDOCTOR_SECRET bilan so'rov yuboradi,
    # javobida esa faqat bitta o'qish-uchun raqam (balans) qaytadi.
    secret = request.headers.get("X-Vidoctor-Secret", "")
    if not hmac.compare_digest(secret, VIDOCTOR_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")
    balance = _get_openrouter_balance()
    if balance is None:
        raise HTTPException(status_code=502, detail="OpenRouter balance fetch failed")
    return {"balance": balance}


# VAQTINCHALIK DIAGNOSTIKA: bot.php video_analiz oqimi qayerda to'xtayotganini
# aniqlash uchun. Muammo tuzatilgach shu endpoint (va bot.php dagi chaqiruv)
# olib tashlanishi kerak.
@api.post("/debug-log")
async def debug_log(request: Request):
    secret = request.headers.get("X-Vidoctor-Secret", "")
    if not hmac.compare_digest(secret, VIDOCTOR_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        body = await request.json()
    except Exception:
        body = {}
    log.warning(f"BOT.PHP DEBUG: {json.dumps(body, ensure_ascii=False)}")
    return {"ok": True}


def start_api_server():
    """Bot bilan parallel ishga tushirish uchun."""
    config = uvicorn.Config(
        api,
        host="0.0.0.0",
        port=API_PORT,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    loop = asyncio.new_event_loop()
    loop.run_until_complete(server.serve())
