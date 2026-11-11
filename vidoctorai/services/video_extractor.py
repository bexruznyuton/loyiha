import subprocess
import json
import os
import re
import base64
import tempfile
from PIL import Image
import numpy as np

_NULL = os.devnull  # cross-platform: /dev/null (Linux/Mac) yoki NUL (Windows)


def _find_bin(name: str) -> str:
    """Tizimda binary ishlasa ishlatiladi, ishlamasa imageio-ffmpeg bundled binary."""
    import shutil
    candidate = shutil.which(name)
    if candidate:
        try:
            r = subprocess.run([candidate, "-version"], capture_output=True, timeout=5)
            if r.returncode == 0:
                return candidate
        except Exception:
            pass
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        bundled = ff if name == "ffmpeg" else ff.replace("ffmpeg", name)
        if os.path.exists(bundled):
            return bundled
    except ImportError:
        pass
    return name  # so'nggi imkoniyat


_FFMPEG  = _find_bin("ffmpeg")
_FFPROBE = _find_bin("ffprobe")


def get_metadata(video_path: str) -> dict:
    """PyAV orqali metadata olish — ffprobe shart emas."""
    try:
        import av as _av
        with _av.open(video_path) as container:
            vs = next((s for s in container.streams if s.type == "video"), None)
            aus = next((s for s in container.streams if s.type == "audio"), None)

            dur = float(container.duration or 0) / 1_000_000  # microseconds → seconds
            size_mb = os.path.getsize(video_path) / (1024 * 1024)
            br = int((container.bit_rate or 0) / 1000)

            if vs:
                w, h = vs.width, vs.height
                fps_r = vs.average_rate or vs.base_rate
                fps = round(float(fps_r) if fps_r else 0, 1)
                codec = vs.codec_context.name if vs.codec_context else "unknown"
            else:
                w = h = fps = 0
                codec = "unknown"

            return {
                "duration_sec": round(dur, 1),
                "width": w,
                "height": h,
                "fps": fps,
                "bitrate_kbps": br,
                "file_size_mb": round(size_mb, 1),
                "is_vertical": h > w,
                "aspect_ratio": f"{w}x{h}",
                "has_audio": aus is not None,
                "codec": codec,
            }
    except Exception:
        return {}


def _extract_frame(video_path: str, timestamp: float, out_path: str) -> bool:
    cmd = [
        _FFMPEG, "-ss", str(timestamp), "-i", video_path,
        "-vframes", "1", "-q:v", "3", "-vf", "scale=480:-1",
        out_path, "-y"
    ]
    try:
        return subprocess.run(cmd, capture_output=True, timeout=30).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def _analyze_frame(img_path: str) -> dict:
    try:
        img = Image.open(img_path).convert("RGB")
        arr = np.array(img, dtype=np.float32)

        brightness = float(arr.mean())
        contrast = float(arr.std())

        # HSV saturation — numpy orqali hisoblash (Pillow HSV rejimi ishonchsiz)
        r = arr[:, :, 0] / 255.0
        g = arr[:, :, 1] / 255.0
        b = arr[:, :, 2] / 255.0
        cmax = np.maximum(np.maximum(r, g), b)
        cmin = np.minimum(np.minimum(r, g), b)
        diff = cmax - cmin
        saturation = float(np.where(cmax > 0, diff / cmax, 0).mean()) * 255.0

        return {
            "brightness": round(brightness, 1),
            "contrast": round(contrast, 1),
            "saturation": round(saturation, 1),
            "is_bright": brightness > 130,
            "is_colorful": saturation > 60,
        }
    except Exception:
        return {}


def _motion_score(frame1_path: str, frame2_path: str) -> float:
    try:
        a = np.array(Image.open(frame1_path).convert("L"), dtype=np.float32)
        b = np.array(Image.open(frame2_path).convert("L"), dtype=np.float32)
        return round(float(np.abs(a - b).mean()), 1)
    except Exception:
        return 0.0


def _audio_metrics(video_path: str) -> dict:
    cmd = [
        _FFMPEG, "-i", video_path,
        "-af", "volumedetect",
        "-f", "null", _NULL
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return {}
    text = out.stderr

    def parse(key):
        m = re.search(rf"{key}:\s*([-\d.]+)", text)
        return float(m.group(1)) if m else None

    return {
        "mean_volume_db": parse("mean_volume"),
        "max_volume_db": parse("max_volume"),
    }


def _hook_audio_energy(video_path: str, duration: float = 3.0) -> dict:
    cmd = [
        _FFMPEG, "-i", video_path,
        "-t", str(duration),
        "-af", "volumedetect",
        "-f", "null", _NULL
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return {}
    m = re.search(r"mean_volume:\s*([-\d.]+)", out.stderr)
    mean = float(m.group(1)) if m else None
    return {"hook_audio_mean_db": mean}


def extract_hook_audio_b64(video_path: str, duration: float = 5.0) -> str | None:
    """Hook (birinchi N sekund) audiosini MP3 sifatida base64 qaytaradi."""
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, "hook.mp3")
        cmd = [
            _FFMPEG, "-i", video_path,
            "-t", str(duration),
            "-vn",                  # faqat audio
            "-ar", "16000",         # 16kHz (nutq tanish uchun optimal)
            "-ac", "1",             # mono
            "-b:a", "64k",
            out_path, "-y"
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=30)
        except subprocess.TimeoutExpired:
            return None
        if result.returncode == 0 and os.path.exists(out_path):
            with open(out_path, "rb") as f:
                return base64.b64encode(f.read()).decode()
    return None


def extract_frames_b64(video_path: str, count: int = 4) -> list[str]:
    """
    Video bo'ylab teng taqsimlangan kadrlarni JPEG base64 sifatida qaytaradi.
    Gemini ga vizual kontekst berish uchun — video turini aniqlashda hal qiluvchi.
    """
    meta = get_metadata(video_path)
    dur = meta.get("duration_sec", 10) or 10

    # hook + teng oraliqlar (masalan 4 ta: 0.5s, 30%, 60%, oxiri-1.5s)
    timestamps = [0.5]
    for i in range(1, count - 1):
        timestamps.append(dur * i / (count - 1))
    timestamps.append(max(0.5, dur - 1.5))

    frames = []
    with tempfile.TemporaryDirectory() as tmpdir:
        for idx, ts in enumerate(timestamps[:count]):
            p = os.path.join(tmpdir, f"g{idx}.jpg")
            if _extract_frame(video_path, ts, p):
                with open(p, "rb") as f:
                    frames.append(base64.b64encode(f.read()).decode())
    return frames


def extract_all(video_path: str) -> dict:
    meta = get_metadata(video_path)
    dur = meta.get("duration_sec", 10)

    timestamps = {
        "hook": 0.5,
        "early": min(2.5, dur * 0.15),
        "mid": dur * 0.5,
        "end": max(0, dur - 1.5),
    }

    frame_data = {}
    motion_scores = []

    with tempfile.TemporaryDirectory() as tmpdir:
        paths = {}
        for name, ts in timestamps.items():
            p = os.path.join(tmpdir, f"{name}.jpg")
            if _extract_frame(video_path, ts, p):
                paths[name] = p

        prev_path = None
        for name, p in paths.items():
            frame_data[name] = _analyze_frame(p)
            if prev_path:
                motion_scores.append(_motion_score(prev_path, p))
            prev_path = p

    audio = _audio_metrics(video_path) if meta.get("has_audio") else {}
    hook_audio = _hook_audio_energy(video_path) if meta.get("has_audio") else {}

    avg_motion = round(sum(motion_scores) / len(motion_scores), 1) if motion_scores else 0
    hook_motion = motion_scores[0] if motion_scores else 0

    return {
        "metadata": meta,
        "visual": {
            "hook_frame": frame_data.get("hook", {}),
            "avg_brightness": round(
                sum(f.get("brightness", 0) for f in frame_data.values()) / max(len(frame_data), 1), 1
            ),
            "avg_saturation": round(
                sum(f.get("saturation", 0) for f in frame_data.values()) / max(len(frame_data), 1), 1
            ),
            "avg_motion_score": avg_motion,
            "hook_motion_score": round(hook_motion, 1),
        },
        "audio": {**audio, **hook_audio},
    }
