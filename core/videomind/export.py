from fractions import Fraction
from pathlib import Path

import av

Chunks = list[tuple[float, float]]


def export_chunks(video_path: str, chunks: Chunks, out_dir: str) -> list[str]:
    """Write each chunk out as its own mp4 (video + audio).

    Decodes the source once and routes every frame to whichever chunk covers
    its timestamp, rather than re-opening and re-seeking the file per chunk.
    """
    out_path = Path(out_dir)
    if out_path.exists():
        for old in out_path.glob("chunk_*.mp4"):
            old.unlink()
    out_path.mkdir(parents=True, exist_ok=True)

    container = av.open(video_path)
    v_in = container.streams.video[0]
    a_in = container.streams.audio[0] if container.streams.audio else None

    fps = Fraction(v_in.average_rate)

    writers = []
    for i, (start, end) in enumerate(chunks):
        path = out_path / f"chunk_{i:03d}_{start:07.2f}-{end:07.2f}s.mp4"
        out = av.open(str(path), "w")

        v_out = out.add_stream("libx264", rate=fps)
        v_out.width, v_out.height, v_out.pix_fmt = v_in.width, v_in.height, "yuv420p"
        v_out.time_base = v_in.time_base
        v_out.options = {"preset": "veryfast", "crf": "26"}

        a_out = None
        if a_in is not None:
            a_out = out.add_stream("aac", rate=a_in.rate)
            a_out.layout = a_in.layout
            a_out.time_base = a_in.time_base

        writers.append(
            {
                "path": str(path),
                "out": out,
                "v": v_out,
                "a": a_out,
                "start": start,
                "end": end,
                "v_pts": None,
                "a_pts": None,
            }
        )

    streams = [v_in] + ([a_in] if a_in is not None else [])
    resampler = (
        av.AudioResampler(format="fltp", layout=a_in.layout, rate=a_in.rate)
        if a_in is not None
        else None
    )

    for frame in container.decode(*streams):
        if frame.pts is None:
            continue
        timestamp = float(frame.pts * frame.time_base)
        writer = next((w for w in writers if w["start"] <= timestamp < w["end"]), None)
        if writer is None:
            continue

        if isinstance(frame, av.VideoFrame):
            if writer["v_pts"] is None:
                writer["v_pts"] = frame.pts
            frame.pts -= writer["v_pts"]
            for packet in writer["v"].encode(frame):
                writer["out"].mux(packet)
        elif writer["a"] is not None:
            if writer["a_pts"] is None:
                writer["a_pts"] = frame.pts
            for resampled in resampler.resample(frame):
                if resampled.pts is not None:
                    resampled.pts -= writer["a_pts"]
                for packet in writer["a"].encode(resampled):
                    writer["out"].mux(packet)

    container.close()

    for writer in writers:
        for packet in writer["v"].encode():
            writer["out"].mux(packet)
        if writer["a"] is not None:
            for packet in writer["a"].encode():
                writer["out"].mux(packet)
        writer["out"].close()

    return [w["path"] for w in writers]
