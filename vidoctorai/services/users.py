"""
SQLite-based user tracking moduli.

Jadval: users
  - user_id         INTEGER PRIMARY KEY  (Telegram user ID)
  - username        TEXT                 (@ belgisisiz, NULL bo'lishi mumkin)
  - first_seen      TEXT                 (ISO-8601 UTC timestamp)
  - total_analyses  INTEGER DEFAULT 0
  - last_analysis_at TEXT               (ISO-8601 UTC, NULL — hech tahlil yo'q)
"""

import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

# DB fayl loyiha ildizida saqlanadi — bot.py bilan bir papkada
_DB_PATH = Path(__file__).resolve().parent.parent / "users.db"


# ---------------------------------------------------------------------------
# Ichki yordamchi funksiyalar
# ---------------------------------------------------------------------------

def _get_connection() -> sqlite3.Connection:
    """
    Har safar yangi connection ochadi va WAL rejimini yoqadi.
    WAL — bir vaqtda o'qish/yozish uchun xavfsizroq.
    """
    conn = sqlite3.connect(str(_DB_PATH), timeout=10)
    conn.row_factory = sqlite3.Row          # natijani dict-kabi ishlatish uchun
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _utcnow() -> str:
    """Hozirgi UTC vaqtni ISO-8601 formatida qaytaradi."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Jadval yaratish — modul import qilinganda bir marta ishlaydi
# ---------------------------------------------------------------------------

def init_db() -> None:
    """
    users jadvalini yaratadi (agar mavjud bo'lmasa).
    Bot ishga tushganda bir marta chaqirilishi kerak.
    """
    try:
        with _get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id              INTEGER PRIMARY KEY,
                    username             TEXT,
                    first_seen           TEXT    NOT NULL,
                    total_analyses       INTEGER NOT NULL DEFAULT 0,
                    last_analysis_at     TEXT,
                    last_viral_percentage INTEGER
                )
            """)
            # Eski DB ga ustun qo'shish (migration)
            try:
                conn.execute("ALTER TABLE users ADD COLUMN last_viral_percentage INTEGER")
            except sqlite3.OperationalError:
                pass  # Ustun allaqachon bor
            conn.commit()
        log.info(f"SQLite DB tayyor: {_DB_PATH}")
    except sqlite3.Error as exc:
        log.error(f"init_db xatolik: {exc}")
        raise


# ---------------------------------------------------------------------------
# Asosiy funksiyalar
# ---------------------------------------------------------------------------

def get_or_create_user(user_id: int, username: str | None = None) -> dict:
    """
    Foydalanuvchini DB dan oladi yoki yangi yaratadi.

    Parametrlar:
        user_id  : Telegram foydalanuvchi ID si (musbat butun son)
        username : Telegram @username (@ belgisisiz, ixtiyoriy)

    Qaytaradi:
        dict — users jadvalining bir qatori:
            {
                "user_id":          int,
                "username":         str | None,
                "first_seen":       str,   # ISO-8601 UTC
                "total_analyses":   int,
                "last_analysis_at": str | None
            }

    Agar username o'zgargan bo'lsa, yangilaydi.
    """
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError(f"user_id musbat butun son bo'lishi kerak, keldi: {user_id!r}")

    try:
        with _get_connection() as conn:
            # Mavjud foydalanuvchini tekshir
            row = conn.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()

            if row is None:
                # Yangi foydalanuvchi — INSERT
                now = _utcnow()
                conn.execute(
                    """
                    INSERT INTO users (user_id, username, first_seen, total_analyses, last_analysis_at)
                    VALUES (?, ?, ?, 0, NULL)
                    """,
                    (user_id, username, now),
                )
                conn.commit()
                log.info(f"Yangi foydalanuvchi saqlandi: user_id={user_id}, username={username!r}")

                return {
                    "user_id": user_id,
                    "username": username,
                    "first_seen": now,
                    "total_analyses": 0,
                    "last_analysis_at": None,
                }

            # Mavjud foydalanuvchi — username o'zgarganmi?
            existing = dict(row)
            if existing["username"] != username:
                conn.execute(
                    "UPDATE users SET username = ? WHERE user_id = ?",
                    (username, user_id),
                )
                conn.commit()
                existing["username"] = username
                log.debug(f"Username yangilandi: user_id={user_id}, yangi={username!r}")

            return existing

    except sqlite3.Error as exc:
        log.error(f"get_or_create_user xatolik (user_id={user_id}): {exc}")
        raise


def increment_analysis_count(user_id: int) -> dict:
    """
    Foydalanuvchining total_analyses ni 1 ga oshiradi
    va last_analysis_at ni hozirgi UTC vaqtga o'rnatadi.

    Parametrlar:
        user_id : Telegram foydalanuvchi ID si

    Qaytaradi:
        dict — yangilangan foydalanuvchi ma'lumotlari

    Foydalanuvchi topilmasa ValueError ko'taradi.
    """
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError(f"user_id musbat butun son bo'lishi kerak, keldi: {user_id!r}")

    try:
        with _get_connection() as conn:
            now = _utcnow()
            cursor = conn.execute(
                """
                UPDATE users
                SET total_analyses   = total_analyses + 1,
                    last_analysis_at = ?
                WHERE user_id = ?
                """,
                (now, user_id),
            )
            conn.commit()

            if cursor.rowcount == 0:
                raise ValueError(
                    f"increment_analysis_count: user_id={user_id} DB da topilmadi. "
                    "Avval get_or_create_user() chaqiring."
                )

            # Yangilangan qatorni qaytaramiz
            row = conn.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()

            updated = dict(row)
            log.info(
                f"Tahlil soni oshirildi: user_id={user_id}, "
                f"total={updated['total_analyses']}, at={now}"
            )
            return updated

    except sqlite3.Error as exc:
        log.error(f"increment_analysis_count xatolik (user_id={user_id}): {exc}")
        raise


def get_user_stats(user_id: int) -> dict | None:
    """
    Foydalanuvchi statistikasini qaytaradi.

    Parametrlar:
        user_id : Telegram foydalanuvchi ID si

    Qaytaradi:
        dict  — foydalanuvchi ma'lumotlari (topilsa)
        None  — foydalanuvchi DB da yo'q bo'lsa

    Qaytariladigan dict tuzilmasi:
        {
            "user_id":          int,
            "username":         str | None,
            "first_seen":       str,          # ISO-8601 UTC
            "total_analyses":   int,
            "last_analysis_at": str | None,   # ISO-8601 UTC
            "days_since_first": int,          # qancha kun avval ro'yxatdan o'tgan
        }
    """
    if not isinstance(user_id, int) or user_id <= 0:
        raise ValueError(f"user_id musbat butun son bo'lishi kerak, keldi: {user_id!r}")

    try:
        with _get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()

            if row is None:
                log.debug(f"get_user_stats: user_id={user_id} topilmadi")
                return None

            stats = dict(row)

            # Qancha kun avval ro'yxatdan o'tganini hisoblash
            try:
                first_dt = datetime.strptime(stats["first_seen"], "%Y-%m-%dT%H:%M:%SZ")
                first_dt = first_dt.replace(tzinfo=timezone.utc)
                delta = datetime.now(timezone.utc) - first_dt
                stats["days_since_first"] = delta.days
            except (ValueError, TypeError):
                stats["days_since_first"] = 0

            return stats

    except sqlite3.Error as exc:
        log.error(f"get_user_stats xatolik (user_id={user_id}): {exc}")
        raise


def get_last_viral_percentage(user_id: int) -> int | None:
    """Foydalanuvchining oldingi viral_percentage ni qaytaradi (yo'q bo'lsa None)."""
    try:
        with _get_connection() as conn:
            row = conn.execute(
                "SELECT last_viral_percentage FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
            return row["last_viral_percentage"] if row else None
    except sqlite3.Error as exc:
        log.error(f"get_last_viral_percentage xatolik: {exc}")
        return None


def update_viral_percentage(user_id: int, percentage: int) -> None:
    """Foydalanuvchining last_viral_percentage ni yangilaydi."""
    try:
        with _get_connection() as conn:
            conn.execute(
                "UPDATE users SET last_viral_percentage = ? WHERE user_id = ?",
                (percentage, user_id),
            )
            conn.commit()
    except sqlite3.Error as exc:
        log.error(f"update_viral_percentage xatolik: {exc}")


def has_used_today(user_id: int) -> bool:
    """Foydalanuvchi bugun (UTC) allaqachon tahlil qilganmi?"""
    try:
        with _get_connection() as conn:
            row = conn.execute(
                "SELECT last_analysis_at FROM users WHERE user_id = ?", (user_id,)
            ).fetchone()
            if not row or not row["last_analysis_at"]:
                return False
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            return row["last_analysis_at"].startswith(today)
    except sqlite3.Error as exc:
        log.error(f"has_used_today xatolik: {exc}")
        return False


# ---------------------------------------------------------------------------
# Qo'shimcha yordamchi funksiya — umumiy statistika (ixtiyoriy)
# ---------------------------------------------------------------------------

def get_global_stats() -> dict:
    """
    Barcha foydalanuvchilar bo'yicha umumiy statistika.

    Qaytaradi:
        {
            "total_users":     int,   # jami ro'yxatdan o'tgan foydalanuvchilar
            "total_analyses":  int,   # jami tahlillar soni
            "active_users":    int,   # kamida 1 tahlil qilganlar soni
        }
    """
    try:
        with _get_connection() as conn:
            row = conn.execute("""
                SELECT
                    COUNT(*)                              AS total_users,
                    COALESCE(SUM(total_analyses), 0)      AS total_analyses,
                    COUNT(CASE WHEN total_analyses > 0
                               THEN 1 END)                AS active_users
                FROM users
            """).fetchone()

            return {
                "total_users":    row["total_users"],
                "total_analyses": row["total_analyses"],
                "active_users":   row["active_users"],
            }

    except sqlite3.Error as exc:
        log.error(f"get_global_stats xatolik: {exc}")
        raise


# ---------------------------------------------------------------------------
# Modul import qilinganda DB ni avtomatik ishga tushirish
# ---------------------------------------------------------------------------

init_db()
