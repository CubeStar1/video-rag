import av
import numpy as np


def extract_audio(video_path: str, sample_rate: int = 16000) -> tuple[np.ndarray, int]:
    """Decode a video's audio track to mono float32 PCM.

    Uses PyAV, which bundles its own FFmpeg libs, so no system FFmpeg
    install (and no torchcodec) is required.

    A video with no audio track at all is ordinary input - CCTV exports,
    screen captures, anything muxed with `-an` - so this returns an empty
    waveform rather than raising. Callers must therefore not take duration
    from its length (use `poster.duration_of`) and should skip the audio
    detectors instead of feeding them silence, which reads as one video-long
    silence gap.
    """
    container = av.open(video_path)
    if not container.streams.audio:
        container.close()
        return np.zeros(0, dtype=np.float32), sample_rate

    stream = container.streams.audio[0]
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=sample_rate)

    chunks = []
    for frame in container.decode(stream):
        for resampled in resampler.resample(frame):
            chunks.append(resampled.to_ndarray())
    for resampled in resampler.resample(None):
        chunks.append(resampled.to_ndarray())
    container.close()

    if not chunks:
        return np.zeros(0, dtype=np.float32), sample_rate

    waveform = np.concatenate(chunks, axis=1).reshape(-1)
    return waveform.astype(np.float32), sample_rate
