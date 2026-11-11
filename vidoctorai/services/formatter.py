import html

VIDEO_TYPE_LABELS = {
    "uz": {
        "edit":         "🎬 Edit video",
        "talking_head": "🎤 Nutqli video",
        "music_only":   "🎵 Musiqali video",
        "celebrity":    "⭐ Mashhur shaxs",
        "sports":       "⚽ Sport video",
        "car_moto":     "🚗 Avto/Moto",
        "tutorial":     "📚 Ko'rsatma",
        "lifestyle":    "🌅 Lifestyle/Vlog",
        "other":        "📹 Umumiy video",
    },
    "ru": {
        "edit":         "🎬 Эдит видео",
        "talking_head": "🎤 Разговорное видео",
        "music_only":   "🎵 Музыкальное видео",
        "celebrity":    "⭐ Известная личность",
        "sports":       "⚽ Спорт видео",
        "car_moto":     "🚗 Авто/Мото",
        "tutorial":     "📚 Туториал",
        "lifestyle":    "🌅 Лайфстайл/Влог",
        "other":        "📹 Обычное видео",
    },
    "en": {
        "edit":         "🎬 Edit video",
        "talking_head": "🎤 Talking head",
        "music_only":   "🎵 Music video",
        "celebrity":    "⭐ Celebrity",
        "sports":       "⚽ Sports video",
        "car_moto":     "🚗 Car/Moto",
        "tutorial":     "📚 Tutorial",
        "lifestyle":    "🌅 Lifestyle/Vlog",
        "other":        "📹 General video",
    },
}

L10N = {
    "uz": {
        "title":       "📊 TAHLIL",
        "hook":        "Hook",
        "visual":      "Vizual",
        "audio":       "Audio",
        "content":     "Kontent",
        "viral":       "Rek ehtimoli",
        "growth_up":   "📈 Oldingi: <b>{prev}%</b> → <b>{cur}%</b> (+{diff}%) 🔥",
        "growth_down": "📉 Oldingi: <b>{prev}%</b> → <b>{cur}%</b> (-{diff}%)",
        "growth_same": "➡️ Oldingi bilan bir xil: <b>{prev}%</b>",
        "note": ("⚠️ <i>Eslatma: video sifatidan qat'i nazar, "
                 "akkountingiz yoshi, ban tarixi yoki past faollik "
                 "rekga chiqishga to'sqinlik qilishi mumkin.</i>"),
    },
    "ru": {
        "title":       "📊 АНАЛИЗ",
        "hook":        "Хук",
        "visual":      "Визуал",
        "audio":       "Аудио",
        "content":     "Контент",
        "viral":       "Шанс попасть в рек",
        "growth_up":   "📈 Прошлый: <b>{prev}%</b> → <b>{cur}%</b> (+{diff}%) 🔥",
        "growth_down": "📉 Прошлый: <b>{prev}%</b> → <b>{cur}%</b> (-{diff}%)",
        "growth_same": "➡️ Так же, как в прошлый раз: <b>{prev}%</b>",
        "note": ("⚠️ <i>Примечание: независимо от качества видео, "
                 "возраст аккаунта, история банов или низкая активность "
                 "могут помешать попаданию в рекомендации.</i>"),
    },
    "en": {
        "title":       "📊 ANALYSIS",
        "hook":        "Hook",
        "visual":      "Visual",
        "audio":       "Audio",
        "content":     "Content",
        "viral":       "Viral chance",
        "growth_up":   "📈 Previous: <b>{prev}%</b> → <b>{cur}%</b> (+{diff}%) 🔥",
        "growth_down": "📉 Previous: <b>{prev}%</b> → <b>{cur}%</b> (-{diff}%)",
        "growth_same": "➡️ Same as last time: <b>{prev}%</b>",
        "note": ("⚠️ <i>Note: regardless of video quality, "
                 "your account age, ban history or low activity "
                 "may prevent it from going viral.</i>"),
    },
}


def _bar(score: int, total: int = 10, width: int = 8) -> str:
    filled = min(round(score * width / total), width)
    return "█" * filled + "░" * (width - filled)


def _status(score: int, is_percent: bool = False) -> str:
    val = score if not is_percent else score / 10
    if val >= 8:   return "🟢"
    elif val >= 6: return "🟡"
    else:          return "🔴"


def _growth_line(current: int, previous: int | None, t: dict) -> str:
    if previous is None:
        return ""
    diff = current - previous
    if diff > 0:
        return t["growth_up"].format(prev=previous, cur=current, diff=diff)
    elif diff < 0:
        return t["growth_down"].format(prev=previous, cur=current, diff=abs(diff))
    else:
        return t["growth_same"].format(prev=previous)


def format_analysis(result: dict, previous_viral: int | None = None, lang: str = "uz") -> str:
    if lang not in L10N:
        lang = "uz"
    t = L10N[lang]

    hook_s    = result.get("hook_score", 0)
    visual_s  = result.get("visual_score", 0)
    audio_s   = result.get("audio_score", 0)
    content_s = result.get("content_score", 0)
    viral_p   = result.get("viral_percentage", 0)

    def safe(text: str) -> str:
        return html.escape(str(text))

    lines = [
        f"<b>{t['title']}</b>",
        "",
    ]

    rows = [
        ("🎣", t["hook"],    hook_s,    result.get("hook_comment", "")),
        ("🎬", t["visual"],  visual_s,  result.get("visual_comment", "")),
        ("🗣", t["audio"],   audio_s,   result.get("audio_comment", "")),
        ("📝", t["content"], content_s, result.get("content_comment", "")),
    ]

    for icon, name, score, comment in rows:
        lines.append(
            f"{_status(score)} {icon} <b>{name}</b> <b>{score}/10</b> <code>{_bar(score)}</code>"
        )
        if comment:
            lines.append(f"<i>{safe(comment)}</i>")
        lines.append("")

    lines.append("━━━━━━━━━━━━━━━")
    lines.append(
        f"🚀 <b>{t['viral']}: {viral_p}%</b> {_status(viral_p, is_percent=True)}"
    )

    viral_comment = result.get("viral_comment", "")
    if viral_comment:
        lines.append(f"<i>{safe(viral_comment)}</i>")

    growth = _growth_line(viral_p, previous_viral, t)
    if growth:
        lines.append(growth)

    overall = result.get("overall_comment", "")
    if overall:
        lines.append("")
        lines.append(f"<i>{safe(overall)}</i>")

    lines.append("")
    lines.append("━━━━━━━━━━━━━━━")
    lines.append(t["note"])
    lines.append("")
    lines.append("👉 @Top_sxema_instagrambot")

    return "\n".join(lines)
