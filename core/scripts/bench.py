
import sys
from pathlib import Path

# Run from anywhere: scripts live one level below the project root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import time
import warnings

warnings.filterwarnings("ignore")

import torch

from videomind import audio_extract, store
from videomind.boundaries import diarization, scenes, semantic, vad
from videomind.chunking import WEIGHTS, boundaries_to_chunks, fuse
from videomind.chunk import _merge_short_chunks, _split_long_chunks
from videomind.export import export_chunks

VIDEO = str(Path(__file__).resolve().parent.parent / "media" / "test.mp4")
PRESET = "video"
MIN_DURATION, MAX_DURATION = 5, 20
OUT_DIR = str(Path(__file__).resolve().parent.parent / "data" / "chunk_clips")

print(f"GPU: {torch.cuda.get_device_name(0)}  cuda={torch.cuda.is_available()}")

timings = {}


def stage(name, fn):
    start = time.time()
    result = fn()
    timings[name] = time.time() - start
    print(f"  {name:28s} {timings[name]:6.1f}s", flush=True)
    return result


print("\n--- detectors ---")
waveform, sample_rate = stage("audio extract (PyAV, CPU)", lambda: audio_extract.extract_audio(VIDEO))
duration = len(waveform) / sample_rate

annotation = stage("pyannote diarize (GPU)", lambda: diarization.diarize(waveform, sample_rate))
speech = stage("silero vad (GPU)", lambda: vad.detect_speech(waveform, sample_rate))
scene_list = stage("pyscenedetect (CPU)", lambda: scenes.detect_cuts(VIDEO))
embeddings = stage("clip embeddings (GPU)", lambda: semantic.frame_embeddings(VIDEO))

events = {
    "speaker": diarization.speaker_change_boundaries(annotation),
    "silence": vad.silence_boundaries(speech, duration),
    "cut": scenes.cut_boundaries(scene_list),
    "semantic": semantic.semantic_boundaries(embeddings),
}
print("\n  boundary events:", {k: len(v) for k, v in events.items()})

print("\n--- fuse + constrain ---")
chunks = stage(
    f"fuse ({PRESET} preset)",
    lambda: boundaries_to_chunks(fuse(events, WEIGHTS[PRESET], duration), duration),
)
chunks = _split_long_chunks(chunks, MAX_DURATION)
chunks = _merge_short_chunks(chunks, MIN_DURATION)
lengths = [e - s for s, e in chunks]
print(f"  {len(chunks)} chunks  min={min(lengths):.1f}s max={max(lengths):.1f}s "
      f"mean={sum(lengths) / len(lengths):.1f}s")

print("\n--- export ---")
paths = stage(f"export {len(chunks)} clips", lambda: export_chunks(VIDEO, chunks, OUT_DIR))

record = store.build(VIDEO, chunks, preset=PRESET, min_duration=MIN_DURATION, max_duration=MAX_DURATION)
for i, path in enumerate(paths):
    store.attach(record, i, clip=path)
store.save(record, f"{OUT_DIR}/chunks.json")

total = sum(timings.values())
print(f"\n--- total {total:.1f}s for {duration:.0f}s of video ({duration / total:.1f}x realtime) ---")
for name, seconds in sorted(timings.items(), key=lambda kv: -kv[1]):
    print(f"  {name:28s} {seconds:6.1f}s  {seconds / total * 100:4.1f}%")
print(f"\nclips -> {OUT_DIR}/")
