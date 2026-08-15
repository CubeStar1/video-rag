"""A video with no audio track at all.

Both committed fixtures (`media/test.mp4`, `media/speech_test.mp4`) carry an
audio stream, so nothing exercised the case where `container.streams.audio` is
empty - which is ordinary input: CCTV exports, screen captures, anything muxed
with `-an`. It used to raise `IndexError: tuple index out of range` out of
`audio_extract`, three frames below the ingest call.

The clip is synthesised here rather than committed: it needs no models, and a
2-second 64x48 file makes the property under test - no audio stream - obvious
in a way a binary blob does not.
"""

import numpy as np
import pytest

from src import audio_extract, poster
from src.boundaries import diarization, vad
from src.chunk import chunk_video
from src.extractors.audio import transcript as whisper

FPS = 10
SECONDS = 2.0


@pytest.fixture(scope="module")
def silent_video(tmp_path_factory) -> str:
    """A short video encoded with a video stream and nothing else."""
    import av

    path = tmp_path_factory.mktemp("silent") / "no_audio.mp4"
    container = av.open(str(path), mode="w")
    stream = container.add_stream("mpeg4", rate=FPS)
    stream.width, stream.height = 64, 48
    stream.pix_fmt = "yuv420p"

    for i in range(int(FPS * SECONDS)):
        shade = np.full((48, 64, 3), (i * 12) % 256, dtype=np.uint8)
        for packet in stream.encode(av.VideoFrame.from_ndarray(shade, format="rgb24")):
            container.mux(packet)
    for packet in stream.encode():
        container.mux(packet)
    container.close()

    return str(path)


def test_the_fixture_really_has_no_audio_stream(silent_video):
    import av

    with av.open(silent_video) as container:
        assert not container.streams.audio


def test_extracting_audio_returns_an_empty_waveform_instead_of_raising(silent_video):
    waveform, sample_rate = audio_extract.extract_audio(silent_video)

    assert waveform.size == 0
    assert sample_rate == 16000


def test_duration_comes_from_the_container_not_the_waveform(silent_video):
    """The reason a bare try/except around the audio decode is not the fix: with
    duration taken from the waveform, a silent video is 0.0 seconds long and
    ingests 'successfully' as one empty chunk."""
    assert poster.duration_of(silent_video) == pytest.approx(SECONDS, abs=0.2)


def test_interval_chunking_covers_a_silent_video(silent_video):
    chunks = chunk_video(silent_video, interval=0.5)

    assert chunks
    assert chunks[0][0] == 0.0
    assert chunks[-1][1] == pytest.approx(SECONDS, abs=0.2)
    assert all(a[1] == b[0] for a, b in zip(chunks, chunks[1:]))


def test_an_unreadable_video_names_the_problem(tmp_path):
    """Rather than dividing by a zero frame rate or returning no chunks."""
    not_a_video = tmp_path / "broken.mp4"
    not_a_video.write_bytes(b"not an mp4")

    with pytest.raises(ValueError, match="Could not determine a duration"):
        chunk_video(str(not_a_video), interval=1.0)


def test_the_audio_detectors_no_op_on_an_empty_waveform():
    """So they can be called on a silent video without loading a model or
    fabricating a boundary."""
    empty = np.zeros(0, dtype=np.float32)

    assert vad.detect_speech(empty, 16000) == []
    assert diarization.speaker_change_boundaries(diarization.diarize(empty, 16000)) == []
    assert whisper.detect_language(empty, 16000) is None


def test_silence_boundaries_would_fabricate_one_for_the_whole_clip():
    """Why `collect_boundaries` skips the audio detectors rather than running
    them on silence: no speech reads as one video-long gap, and a boundary at
    its midpoint is an artefact of the missing track, not of the content."""
    fabricated = vad.silence_boundaries([], duration=60.0)

    assert fabricated == [(30.0, 1.0)]
