"""Shared helpers for aggregators that call the LLM."""

import json

from ..extractors.video.openai_call import DEFAULT_MODEL, _get_client


def complete(prompt: str, schema: dict | None = None, model: str | None = None) -> dict | str:
    """One text-only completion, optionally with structured output."""
    kwargs = {}
    if schema is not None:
        kwargs["response_format"] = {"type": "json_schema", "json_schema": schema}

    response = _get_client().chat.completions.create(
        model=model or DEFAULT_MODEL,
        messages=[{"role": "user", "content": prompt}],
        **kwargs,
    )
    text = response.choices[0].message.content.strip()
    return json.loads(text) if schema is not None else text


def chunk_lines(ctx, analyzer_ids: list[str], limit: int = 400) -> list[str]:
    """One line per chunk: its timecode plus whatever the analyzers said.

    The common input for every text aggregator - summaries, chapters, events
    all reduce over the same rendering rather than each inventing their own.
    """
    lines = []
    for chunk in ctx.chunks():
        parts = []
        for analyzer_id in analyzer_ids:
            output = chunk.get(analyzer_id)
            if not output:
                continue
            if isinstance(output, str):
                parts.append(output)
            elif "text" in output and analyzer_id == "diarization":
                parts.append(output["text"])
            else:
                parts.append(output.get("description") or output.get("summary") or "")
        body = " ".join(p for p in parts if p).strip()
        if body:
            lines.append(f"[{chunk['id']}] {chunk['start']:.1f}-{chunk['end']:.1f}s: {body[:limit]}")
    return lines


def pick_analyzers(ctx, preference: tuple[str, ...]) -> list[str]:
    """The available analyzers worth reading, best first."""
    available = ctx.record.get("analyzers", [])
    return [a for a in preference if a in available]
