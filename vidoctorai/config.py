import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
TELEGRAM_API_ID = int(os.getenv("TELEGRAM_API_ID", "0"))
TELEGRAM_API_HASH = os.getenv("TELEGRAM_API_HASH", "")

# bot.php (shared hosting) bilan bog'lanish — AI fallback aniqlanganda video
# tahlilni admin panel bayrog'i orqali avtomatik o'chirish uchun (bot.php dagi
# INSTACAP_FORWARD_SECRET bilan BIR XIL bo'lishi shart).
BOT_PHP_RELAY_URL = os.getenv("BOT_PHP_RELAY_URL", "https://example.com/bot/bot.php")
BOT_PHP_FORWARD_SECRET = os.getenv("BOT_PHP_FORWARD_SECRET", "INSTACAP_BRIDGE_SHARED_SECRET_CHANGE_ME")

TEMP_DIR = "temp_videos"
os.makedirs(TEMP_DIR, exist_ok=True)
