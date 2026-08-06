"""A YouTube URL has to reach the fetcher, and only a YouTube URL.

Nothing here touches the network. The cases that matter offline are the host
match (a miss sends the URL down the plain-HTTP path, which gets a player page
instead of a video), the guards that reject a download before it starts, and
the format choice, which silently decides the resolution every analyzer
downstream gets to work with.
"""

from pathlib import Path

import pytest

from videomind import youtube


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",
        "https://youtube.com/watch?v=jNQXAC9IVRw",
        "https://youtu.be/jNQXAC9IVRw",
        "https://m.youtube.com/watch?v=jNQXAC9IVRw",
        "https://music.youtube.com/watch?v=jNQXAC9IVRw",
        "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw",
        "https://YouTube.com/watch?v=jNQXAC9IVRw",
        "https://www.youtube.com/shorts/jNQXAC9IVRw",
    ],
)
def test_youtube_urls_are_recognised(url):
    assert youtube.is_youtube(url)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/clip.mp4",
        "https://notyoutube.com/watch?v=x",
        # The host is what decides, not a substring: a path or a subdomain
        # containing "youtube.com" belongs to whoever owns the actual host.
        "https://evil.com/youtube.com/watch?v=x",
        "https://youtube.com.evil.com/watch?v=x",
    ],
)
def test_other_urls_are_left_to_the_http_path(url):
    assert not youtube.is_youtube(url)


def test_a_live_stream_is_refused():
    """A stream has no end, so there is nothing to chunk."""
    with pytest.raises(youtube.YouTubeError, match="live stream"):
        youtube._check({"is_live": True, "duration": None, "title": "Live now"})


def test_an_over_long_video_is_refused(monkeypatch):
    """Analyzers bill per chunk, and a YouTube URL makes a ten-hour video a
    one-line mistake that the plain HTTP path could never receive by accident."""
    monkeypatch.setattr(youtube, "MAX_DURATION", 600)
    with pytest.raises(youtube.YouTubeError, match="the limit is"):
        youtube._check({"duration": 4000, "title": "Long"})
    youtube._check({"duration": 599, "title": "Short"})


def test_no_duration_limit_when_disabled(monkeypatch):
    monkeypatch.setattr(youtube, "MAX_DURATION", 0)
    youtube._check({"duration": 10**6, "title": "Very long"})


def test_format_falls_back_to_progressive_without_ffmpeg(monkeypatch, tmp_path):
    """Without ffmpeg the two streams of a 1080p video cannot be joined, so ask
    for one that already carries both rather than downloading halves."""
    monkeypatch.setattr(youtube, "FFMPEG", "")
    monkeypatch.setattr(youtube.shutil, "which", lambda _: None)
    options = youtube._options(tmp_path, 1 << 30)
    assert options["format"] == youtube.FORMAT_PROGRESSIVE
    assert "merge_output_format" not in options


def test_format_merges_when_ffmpeg_is_available(monkeypatch, tmp_path):
    monkeypatch.setattr(youtube, "FFMPEG", "")
    monkeypatch.setattr(youtube.shutil, "which", lambda _: "/usr/bin/ffmpeg")
    options = youtube._options(tmp_path, 1 << 30)
    assert options["format"] == youtube.FORMAT_MERGED
    assert options["merge_output_format"] == "mp4"
    assert options["ffmpeg_location"] == "/usr/bin/ffmpeg"


def test_an_ffmpeg_override_that_does_not_exist_is_not_used(monkeypatch):
    """Handing yt-dlp a path with no binary at it fails at merge time, after
    the download - worse than never asking it to merge."""
    monkeypatch.setattr(youtube, "FFMPEG", str(Path("no") / "such" / "ffmpeg"))
    assert youtube.ffmpeg_path() is None


def test_the_download_is_capped_and_never_a_playlist(monkeypatch, tmp_path):
    """A watch URL opened from a playlist still means that one video, and the
    byte cap has to reach yt-dlp - nothing downstream can undo a 40 GB pull."""
    monkeypatch.setattr(youtube, "FFMPEG", "")
    options = youtube._options(tmp_path, 12345)
    assert options["max_filesize"] == 12345
    assert options["noplaylist"] is True


def test_the_largest_finished_file_is_chosen(tmp_path):
    """The fallback scan must ignore yt-dlp's partial files."""
    (tmp_path / "video.mp4").write_bytes(b"x" * 100)
    (tmp_path / "video.f140.m4a.part").write_bytes(b"x" * 500)
    assert youtube._downloaded_file({}, tmp_path).name == "video.mp4"


def test_a_download_that_wrote_nothing_is_an_error(tmp_path):
    """yt-dlp skips a format over `max_filesize` and still reports success."""
    with pytest.raises(youtube.YouTubeError, match="wrote no file"):
        youtube._downloaded_file({}, tmp_path)
