
VECTOR_FIELDS = ("combined", "description", "people", "actions", "objects")


def _structured_combined(output: dict) -> str:
    parts = [output.get("description", "")]
    if setting := output.get("setting"):
        parts.append(f"Setting: {setting}")
    for field in ("people", "actions", "objects", "tags"):
        if values := output.get(field):
            parts.append(f"{field.capitalize()}: {', '.join(values)}")
    return "\n".join(p for p in parts if p).strip()


def render_structured_scene(output: dict) -> dict[str, str]:
    """Video 'default' extractor: structured scene description."""
    fields = {"combined": _structured_combined(output)}

    if description := output.get("description", "").strip():
        fields["description"] = description
    if people := output.get("people"):
        fields["people"] = "; ".join(people)
    if actions := output.get("actions"):
        fields["actions"] = "; ".join(actions)
    if objects := output.get("objects"):
        fields["objects"] = ", ".join(objects)

    return {k: v for k, v in fields.items() if v.strip()}


def render_transcript(output: str | dict) -> dict[str, str]:
    """Audio 'transcript' extractor: one blob of speech, so combined only."""
    text = (output.get("transcript") if isinstance(output, dict) else output) or ""
    text = text.strip()
    return {"combined": text} if text else {}


RENDERERS = {
    "default_video": render_structured_scene,
    "transcript": render_transcript,
}


def render_fields(extractor_id: str, output) -> dict[str, str]:
    """Flatten an extractor's output into {vector_name: text_to_embed}."""
    renderer = RENDERERS.get(extractor_id)
    if renderer is None:
        raise KeyError(
            f"No embed-text renderer registered for extractor {extractor_id!r}. "
            f"Known: {sorted(RENDERERS)}"
        )
    return renderer(output)


def render(extractor_id: str, output) -> str:
    """Just the combined text (what the default search space embeds)."""
    return render_fields(extractor_id, output).get("combined", "")
