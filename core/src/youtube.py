"""Turn a YouTube watch URL into an mp4 on disk, for `storage.fetch_source`.

Separate from `storage.py` because it is the one fetch that cannot be a plain
HTTP GET: YouTube serves a player page, not bytes, and the media itself sits
behind short-lived signed URLs that have to be resolved per request. yt-dlp
does that resolution; everything after the file lands is the ordinary path.
"""

import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

# youtu.be and the nocookie domain are the same videos with different hosts;
# an id pasted from a share sheet or an embed should not be a different feature.
HOSTS = {
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
}

# A YouTube URL makes it a one-line mistake to hand the pipeline a ten-hour
# stream, which the HTTP path could never receive by accident. Analyzers bill
# per chunk, so the cap is on duration rather than only on bytes.
MAX_DURATION = float(os.environ.get("VIDEOMIND_YT_MAX_DURATION", 3600))

# Signed-in formats. YouTube increasingly refuses anonymous clients on some
# videos; a cookie jar is the supported way through, and it stays opt-in
# because most videos do not need one.
COOKIE_FILE = os.environ.get("VIDEOMIND_YT_COOKIES", "").strip()
COOKIE_BROWSER = os.environ.get("VIDEOMIND_YT_COOKIES_FROM_BROWSER", "").strip()

# An explicit ffmpeg, for a machine that has one but not on PATH. Worth an
# override of its own because whether it resolves decides the resolution the
# whole pipeline gets to analyse - see `ffmpeg_path`.
FFMPEG = os.environ.get("VIDEOMIND_FFMPEG", "").strip()

# Best video plus best audio, merged. Needs ffmpeg on PATH, because the two
# arrive as separate streams.
FORMAT_MERGED = (
    "bv*[height<=?1080][ext=mp4]+ba[ext=m4a]/bv*[height<=?1080]+ba/b[ext=mp4]/b"
)

# One file that already carries both tracks. No merge, so no ffmpeg - but
# YouTube only publishes progressive formats up to 720p, and usually 360p.
FORMAT_PROGRESSIVE = "b[ext=mp4][acodec!=none][vcodec!=none]/b[acodec!=none][vcodec!=none]"


class YouTubeError(RuntimeError):
    """A YouTube URL that could not be turned into a file."""


def is_youtube(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host.removeprefix("www.") in HOSTS


def _ydl():
    """Import yt-dlp late, with an actionable message when it is missing.

    Late because it is the only dependency here that a non-YouTube deployment
    never touches, and importing it at module scope would make `storage` fail
    to load rather than one route fail to run.
    """
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:  # pragma: no cover - depends on the install
        raise YouTubeError(
            "yt-dlp is not installed, so YouTube URLs cannot be fetched. "
            "Install it with `uv pip install yt-dlp` (it is in requirements.txt)."
        ) from exc
    return YoutubeDL


def available() -> bool:
    """Whether a YouTube URL could be fetched right now.

    Called by the API before queueing, so a missing dependency is a 400 at the
    caller rather than a job that fails minutes later with nobody watching.
    """
    try:
        _ydl()
        return True
    except YouTubeError:
        return False


def ffmpeg_path() -> str | None:
    """An ffmpeg binary, or None.

    This decides the resolution every analyzer downstream sees. YouTube only
    publishes 1080p as separate video and audio streams, so joining them needs
    ffmpeg; without it the best single file on offer is usually 360p, which is
    poor input for OCR and for the VLM's scene descriptions.

    PyAV is not a substitute. It bundles ffmpeg's *libraries*, not its command
    line binary, so having PyAV installed says nothing about whether yt-dlp can
    merge.
    """
    if FFMPEG:
        return FFMPEG if Path(FFMPEG).exists() else None
    return shutil.which("ffmpeg")


def _options(dest: Path, max_bytes: int) -> dict:
    """yt-dlp options.

    Asks for a progressive format when there is no ffmpeg, rather than letting
    yt-dlp download two streams it then cannot join.
    """
    ffmpeg = ffmpeg_path()
    options = {
        "format": FORMAT_MERGED if ffmpeg else FORMAT_PROGRESSIVE,
        "outtmpl": str(dest / "%(id)s.%(ext)s"),
        "paths": {"home": str(dest)},
        "noplaylist": True,        # a watch URL inside a playlist means that video
        "playlist_items": "1",
        "max_filesize": max_bytes,
        "retries": 3,
        "socket_timeout": 30,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "consoletitle": False,
    }
    if ffmpeg:
        options["merge_output_format"] = "mp4"
        options["ffmpeg_location"] = ffmpeg
    if COOKIE_FILE:
        options["cookiefile"] = COOKIE_FILE
    elif COOKIE_BROWSER:
        options["cookiesfrombrowser"] = tuple(
            part or None for part in COOKIE_BROWSER.split(":")
        )
    return options


def _check(info: dict) -> None:
    if info.get("is_live"):
        raise YouTubeError(
            "That URL is a live stream, which has no end to chunk. "
            "Ingest the recording once the stream has finished."
        )
    duration = info.get("duration")
    if duration and MAX_DURATION and duration > MAX_DURATION:
        raise YouTubeError(
            f"{info.get('title') or 'That video'} is {duration / 60:.0f} minutes; "
            f"the limit is {MAX_DURATION / 60:.0f} "
            "(raise VIDEOMIND_YT_MAX_DURATION to allow longer)."
        )


def _downloaded_file(info: dict, dest: Path) -> Path:
    """Where the file actually landed.

    Taken from yt-dlp's own report rather than rebuilt from the template: the
    extension depends on the format it settled on, and a merge rewrites it
    again. The directory scan is the fallback for older report shapes.
    """
    for entry in info.get("requested_downloads") or []:
        path = entry.get("filepath") or entry.get("_filename")
        if path and Path(path).exists():
            return Path(path)
    files = [p for p in dest.iterdir() if p.is_file() and not p.name.endswith(".part")]
    if not files:
        raise YouTubeError(
            "yt-dlp reported success but wrote no file. A video larger than "
            "the size limit is the usual cause."
        )
    return max(files, key=lambda p: p.stat().st_size)


@contextmanager
def download(url: str, max_bytes: int):
    """Download `url` to a temporary file and yield `(path, filename)`.

    A context manager because the caller copies the bytes into the content-hash
    cache and the temporary copy is dead the moment it returns; leaving a
    second copy of every video in the temp directory is how a disk fills up.

    `filename` is the video's title, not the download name, which is its opaque
    11-character id. It only reaches Storage keys and the UI - the video id is
    still the hash of the bytes.
    """
    YoutubeDL = _ydl()
    dest = Path(tempfile.mkdtemp(prefix="videomind-yt-"))
    try:
        with YoutubeDL(_options(dest, max_bytes)) as ydl:
            try:
                info = ydl.sanitize_info(ydl.extract_info(url, download=False))
                _check(info)
                info = ydl.sanitize_info(ydl.extract_info(url, download=True))
            except YouTubeError:
                raise
            except Exception as exc:
                raise YouTubeError(f"Could not download {url}: {exc}") from exc

        path = _downloaded_file(info, dest)
        title = info.get("title") or info.get("id") or "video"
        yield path, f"{title}{path.suffix}"
    finally:
        shutil.rmtree(dest, ignore_errors=True)
