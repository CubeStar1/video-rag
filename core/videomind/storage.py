import hashlib
import mimetypes
import os
import shutil
import tempfile
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import httpx
from dotenv import load_dotenv
from supabase import create_client

from .paths import CACHE_DIR, ensure as ensure_dirs

load_dotenv()

BUCKET = os.environ.get("VIDEOMIND_BUCKET", "videos")

MAX_BYTES = int(os.environ.get("VIDEOMIND_MAX_BYTES", 4 * 1024**3))

TIMEOUT = httpx.Timeout(30.0, read=300.0)

ALLOWED_SCHEMES = {"http", "https"}

ACCEPTED_TYPES = ("video/", "application/octet-stream", "application/mp4", "binary/octet-stream")


class StorageError(RuntimeError):
    """Anything that went wrong talking to Supabase Storage."""


@lru_cache(maxsize=1)
def _client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise StorageError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in core/.env "
            "- video storage is not optional, the pipeline reads its input from "
            f"the {BUCKET!r} bucket."
        )
    return create_client(url, key)


def _bucket():
    return _client().storage.from_(BUCKET)


def public_url(storage_path: str) -> str:
    """The bucket is public, so this is a permanent, unsigned URL.

    Built here rather than taken from the SDK's `get_public_url`, which has
    appended a bare `?` in some versions - harmless in a browser, ugly in a
    stored record and in every API response that carries it.
    """
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not base:
        raise StorageError("SUPABASE_URL is not set; cannot build a public URL.")
    return f"{base}/storage/v1/object/public/{BUCKET}/{quote(storage_path)}"


def _safe_name(name: str) -> str:
    """A filename Storage will accept, with the extension preserved.

    Storage keys tolerate far less than a filesystem, and a video that arrived
    as `my video (1).mp4` should not fail to upload for it.
    """
    stem = Path(name).stem or "video"
    suffix = Path(name).suffix
    stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem).strip("_")
    return (stem[:64] or "video") + suffix


def _filename_from_url(url: str) -> str:
    """Best guess at what the thing at the far end is called."""
    return unquote(Path(urlparse(url).path).name) or "video"


def _suffix_for(filename: str, content_type: str) -> str:
    suffix = Path(filename).suffix
    if suffix:
        return suffix
    return mimetypes.guess_extension(content_type or "") or ".mp4"


def _exists(storage_path: str) -> bool:
    """Whether the object is already there, so re-ingest does not re-upload GBs."""
    folder, _, name = storage_path.rpartition("/")
    try:
        return any(entry.get("name") == name for entry in _bucket().list(folder))
    except Exception:
        return False


def _upload(local_path: Path, storage_path: str, content_type: str) -> None:
    if _exists(storage_path):
        return
    try:
        with local_path.open("rb") as handle:
            _bucket().upload(
                storage_path,
                handle,
                {"content-type": content_type or "video/mp4", "upsert": "true"},
            )
    except Exception as exc:
        raise StorageError(f"Upload to {BUCKET}/{storage_path} failed: {exc}") from exc


def put_object(storage_path: str, data: bytes, content_type: str) -> str:
    """Upload bytes already in memory and return their public URL.

    `_upload` streams a file and skips objects that already exist, which is
    right for video - re-ingesting the same bytes must not re-push gigabytes.
    A poster is small and *should* be overwritten, because re-ingesting is how
    you replace one that came out black.
    """
    try:
        _bucket().upload(
            storage_path, data, {"content-type": content_type, "upsert": "true"}
        )
    except Exception as exc:
        raise StorageError(f"Upload to {BUCKET}/{storage_path} failed: {exc}") from exc
    return public_url(storage_path)


def _result(video_id: str, local_path: Path, storage_path: str, filename: str,
            source_url: str | None, size_bytes: int) -> dict:
    return {
        "video_id": video_id,
        "local_path": str(local_path),
        "storage_path": storage_path,
        "video_url": public_url(storage_path),
        "filename": filename,
        "source_url": source_url,
        "size_bytes": size_bytes,
    }


def fetch_source(url: str) -> dict:
    """Download a video from any http(s) URL, cache it, and put it in the bucket.

    The URL may already point into our own bucket - the frontend uploading
    straight to Storage and handing over the link is the expected path. That
    needs no special case: the bytes still have to come down to be decoded, and
    `_exists` then skips the pointless re-upload.
    """
    scheme = urlparse(url).scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise ValueError(f"Unsupported URL scheme {scheme or '(none)'!r}; expected http or https")

    ensure_dirs()
    filename = _filename_from_url(url)
    digest, size = hashlib.sha1(), 0

    handle, tmp_name = tempfile.mkstemp(dir=CACHE_DIR, prefix=".download-")
    os.close(handle)
    tmp = Path(tmp_name)

    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=TIMEOUT) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_type and not content_type.startswith(ACCEPTED_TYPES):
                raise ValueError(
                    f"{url} served {content_type!r}, which is not a video. "
                    "A login or error page is the usual cause."
                )
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > MAX_BYTES:
                raise ValueError(f"{url} is {int(declared)} bytes; the limit is {MAX_BYTES}")

            with tmp.open("wb") as out:
                for block in response.iter_bytes(1 << 20):
                    size += len(block)
                    if size > MAX_BYTES:
                        raise ValueError(f"{url} exceeded the {MAX_BYTES} byte limit")
                    digest.update(block)
                    out.write(block)

        if not size:
            raise ValueError(f"{url} returned an empty body")

        video_id = digest.hexdigest()[:16]
        suffix = _suffix_for(filename, content_type)
        local = CACHE_DIR / f"{video_id}{suffix}"
        if local.exists():
            tmp.unlink()
        else:
            tmp.replace(local)
    except httpx.HTTPError as exc:
        tmp.unlink(missing_ok=True)
        raise ValueError(f"Could not fetch {url}: {exc}") from exc
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    filename = _safe_name(Path(filename).stem + suffix)
    storage_path = f"{video_id}/{filename}"
    _upload(local, storage_path, content_type or "video/mp4")
    return _result(video_id, local, storage_path, filename, url, size)


def put_local(path: str) -> dict:
    """Same, for a file already on this machine - a multipart upload or a script.

    The file is copied into the cache rather than used where it lies, so that
    every video the pipeline touches is reachable by content hash alone and a
    caller's temporary file can be deleted the moment this returns.
    """
    source = Path(path)
    if not source.exists():
        raise FileNotFoundError(f"No such video file: {path}")

    ensure_dirs()
    digest, size = hashlib.sha1(), 0
    with source.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
            size += len(block)
    if not size:
        raise ValueError(f"{path} is empty")

    video_id = digest.hexdigest()[:16]
    suffix = source.suffix or ".mp4"
    local = CACHE_DIR / f"{video_id}{suffix}"
    if not local.exists():
        shutil.copy2(source, local)

    filename = _safe_name(source.name)
    storage_path = f"{video_id}/{filename}"
    _upload(local, storage_path, mimetypes.guess_type(source.name)[0] or "video/mp4")
    return _result(video_id, local, storage_path, filename, None, size)


def local_path_for(video_id: str, storage_path: str | None = None) -> str:
    """The cached file for a video, downloading it back from Storage if needed.

    Called by anything that needs to decode a video it did not just ingest -
    re-running aggregators, a second machine, a wiped cache. Resolving on demand
    is why no local path is stored anywhere: a stored one goes stale the moment
    the data directory moves, which is exactly what the old fallback in
    `video_path_for` existed to paper over.
    """
    ensure_dirs()
    cached = sorted(CACHE_DIR.glob(f"{video_id}.*"))
    if cached:
        return str(cached[0])

    if not storage_path:
        raise FileNotFoundError(
            f"Video {video_id!r} is not cached and its record has no storage_path."
        )
    try:
        data = _bucket().download(storage_path)
    except Exception as exc:
        raise StorageError(f"Could not download {BUCKET}/{storage_path}: {exc}") from exc

    destination = CACHE_DIR / f"{video_id}{Path(storage_path).suffix or '.mp4'}"
    destination.write_bytes(data)
    return str(destination)


def delete(storage_path: str | list[str]) -> None:
    """Remove one or more objects.

    Called by `DELETE /videos/{id}`, which has to take out the video and its
    poster together - bytes that outlive their record are unreachable and
    nothing else will ever collect them.
    """
    paths = [storage_path] if isinstance(storage_path, str) else list(storage_path)
    if not paths:
        return
    try:
        _bucket().remove(paths)
    except Exception as exc:
        raise StorageError(f"Could not delete {paths} from {BUCKET}: {exc}") from exc


def status() -> dict:
    """Whether Storage is actually reachable, for /health.

    A bad key or a missing bucket otherwise surfaces as a failed ingest minutes
    later, on a background thread, in a job nobody is watching.
    """
    try:
        _bucket().list()
        return {"ok": True, "bucket": BUCKET, "error": None}
    except Exception as exc:
        return {"ok": False, "bucket": BUCKET, "error": f"{type(exc).__name__}: {exc}"}
