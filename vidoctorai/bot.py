import os
import logging
import threading
from pyrogram import Client, filters, enums
from pyrogram.types import Message

from config import BOT_TOKEN, TELEGRAM_API_ID, TELEGRAM_API_HASH, TEMP_DIR
from services.video_extractor import extract_all, extract_frames_b64, extract_hook_audio_b64
from services.ai_scorer import score_video
from services.formatter import format_analysis
from services.users import (
    get_or_create_user,
    increment_analysis_count,
    get_last_viral_percentage,
    update_viral_percentage,
    init_db,
)
from services.analyzer_api import start_api_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s — %(levelname)s — %(message)s")
log = logging.getLogger(__name__)

os.makedirs(TEMP_DIR, exist_ok=True)
init_db()

app = Client(
    "vidoctorai_bot",
    api_id=TELEGRAM_API_ID,
    api_hash=TELEGRAM_API_HASH,
    bot_token=BOT_TOKEN,
)


def _is_video_doc(_, __, m: Message) -> bool:
    return bool(m.document and m.document.mime_type and "video" in m.document.mime_type)


async def _progress(current: int, total: int, status_msg, state: dict):
    if total == 0:
        return
    percent = int(current * 100 / total)
    step = percent // 25 * 25
    if step != state.get("last") and step > 0:
        state["last"] = step
        mb = round(current / (1024 * 1024), 1)
        mb_total = round(total / (1024 * 1024), 1)
        try:
            await status_msg.edit_text(f"⬇️ Yuklanmoqda: {step}% ({mb}/{mb_total} MB)")
        except Exception:
            pass


@app.on_message(filters.command("start"))
async def handle_start(client: Client, message: Message):
    user = message.from_user
    log.info(f"/start — user {user.id if user else '?'}")
    if user:
        get_or_create_user(user.id, user.username)
    await message.reply(
        "👋 Salom! Men <b>VIDoctorai</b> — Instagram Reels tahlilchisiman.\n\n"
        "Video yuboring, men uni tahlil qilib:\n"
        "🎣 Hook kuchini\n"
        "🎬 Vizual/Montaj sifatini\n"
        "🗣️ Audio/Nutq darajasini\n"
        "📝 Kontent sifatini\n"
        "📈 Rekka chiqish ehtimolini\n\n"
        "aniqlab beraman! 🚀",
        parse_mode=enums.ParseMode.HTML,
    )


@app.on_message(filters.video | filters.create(_is_video_doc))
async def handle_video(client: Client, message: Message):
    media = message.video or message.document
    file_size_mb = round((media.file_size or 0) / (1024 * 1024), 1)
    user = message.from_user
    user_id = user.id if user else None
    log.info(f"Video keldi: {file_size_mb} MB — user {user_id}")

    status_msg = await message.reply(f"⬇️ Video yuklanmoqda... (0/{file_size_mb} MB)")

    # chat.id + message.id — cross-chat fayl nomi to'qnashuvini oldini olish
    chat_id = message.chat.id if message.chat else "0"
    video_path = os.path.join(TEMP_DIR, f"{chat_id}_{message.id}.mp4")

    try:
        # Foydalanuvchini DB ga qo'shish va oldingi natijani olish
        previous_viral = None
        if user_id:
            get_or_create_user(user_id, user.username if user else None)
            previous_viral = get_last_viral_percentage(user_id)

        state = {"last": 0}
        await client.download_media(
            message,
            file_name=video_path,
            progress=_progress,
            progress_args=(status_msg, state),
        )

        await status_msg.edit_text("📊 Texnik ma'lumotlar o'qilmoqda...")
        data = extract_all(video_path)
        hook_audio = extract_hook_audio_b64(video_path)
        frames = extract_frames_b64(video_path)

        await status_msg.edit_text("🤖 AI tahlil qilmoqda...")
        result = score_video(data, hook_audio, frames)

        viral_p = result.get("viral_percentage", 0)
        text = format_analysis(result, previous_viral=previous_viral)
        await status_msg.edit_text(text, parse_mode=enums.ParseMode.HTML)

        # Muvaffaqiyatli tahlildan keyin DB yangilash
        if user_id:
            increment_analysis_count(user_id)
            update_viral_percentage(user_id, viral_p)

    except Exception as e:
        log.exception("Xatolik")
        await status_msg.edit_text("❌ Xatolik yuz berdi. Iltimos, qayta urinib ko'ring.")
    finally:
        if os.path.exists(video_path):
            os.remove(video_path)


if __name__ == "__main__":
    # FastAPI analyzer server alohida threadda ishga tushadi
    api_thread = threading.Thread(target=start_api_server, daemon=True)
    api_thread.start()
    log.info("VIDoctorai bot ishga tushdi ✅ (Analyzer API ham ishlamoqda)")
    app.run()
