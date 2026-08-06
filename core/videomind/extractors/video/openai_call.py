import base64
import json
import os

import cv2
import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

_client = None

DEFAULT_MODEL = "gpt-5.4-mini"

SCENE_SCHEMA = {
    "name": "scene_description",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["description", "setting", "people", "objects", "actions", "tags"],
        "properties": {
            "description": {
                "type": "string",
                "description": "Prose description of the segment; the main text users search against.",
            },
            "setting": {
                "type": "string",
                "description": "Where this takes place, e.g. 'supermarket checkout area'.",
            },
            "people": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Each person visible, described by role/appearance, never by name.",
            },
            "objects": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Salient objects visible in the segment.",
            },
            "actions": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Discrete actions occurring across the frames.",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Short keywords for filtering.",
            },
        },
    },
}


OCR_SCHEMA = {
    "name": "ocr_reading",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["texts", "summary"],
        "properties": {
            "texts": {
                "type": "array",
                "description": "Each distinct piece of text visible across the frames.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["text", "context"],
                    "properties": {
                        "text": {
                            "type": "string",
                            "description": "The text exactly as written, including case and punctuation.",
                        },
                        "context": {
                            "type": "string",
                            "description": "What this text is and where it appears, e.g. 'a label on a cupboard'.",
                        },
                    },
                },
            },
            "summary": {
                "type": "string",
                "description": "One sentence on what kind of text this segment contains.",
            },
        },
    },
}


OBJECT_SCHEMA = {
    "name": "object_reading",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["detections", "summary"],
        "properties": {
            "detections": {
                "type": "array",
                "description": "Each distinct object worth indexing.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["object", "description", "context"],
                    "properties": {
                        "object": {
                            "type": "string",
                            "description": "Short name for the object, e.g. 'shopping cart'.",
                        },
                        "description": {
                            "type": "string",
                            "description": "What it looks like: colour, material, size, state.",
                        },
                        "context": {
                            "type": "string",
                            "description": "What it is doing or being used for in this scene, and by whom.",
                        },
                    },
                },
            },
            "summary": {
                "type": "string",
                "description": "One sentence on what objects this segment contains.",
            },
        },
    },
}


PEOPLE_SCHEMA = {
    "name": "people_reading",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["people", "summary"],
        "properties": {
            "people": {
                "type": "array",
                "description": "One entry per distinct person visible.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["box_id", "appearance", "clothing", "role", "action"],
                    "properties": {
                        "box_id": {
                            "type": "integer",
                            "description": "The number drawn on this person's box. Use 0 if they had no box.",
                        },
                        "appearance": {
                            "type": "string",
                            "description": "Build, hair, and other lasting physical features. No names, no guesses at identity.",
                        },
                        "clothing": {
                            "type": "string",
                            "description": "Every visible garment with its colour - the most reliable way to recognise them again.",
                        },
                        "role": {
                            "type": "string",
                            "description": "Their apparent role, e.g. 'cashier', 'customer', 'passer-by'.",
                        },
                        "action": {
                            "type": "string",
                            "description": "What they do across these frames, including any movement.",
                        },
                    },
                },
            },
            "summary": {
                "type": "string",
                "description": "One sentence on who is present and what they are doing.",
            },
        },
    },
}


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def _encode(frame: np.ndarray, max_width: int, quality: int) -> str:
    """RGB frame -> base64 JPEG data URI, downscaled to cap vision token cost."""
    height, width = frame.shape[:2]
    if width > max_width:
        scale = max_width / width
        frame = cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)

    bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
    ok, buffer = cv2.imencode(".jpg", bgr, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("failed to JPEG-encode frame")

    return "data:image/jpeg;base64," + base64.b64encode(buffer).decode("ascii")


def describe(
    prompt: str,
    frames: list[np.ndarray],
    model: str = DEFAULT_MODEL,
    detail: str = "auto",
    max_width: int = 768,
    quality: int = 80,
    schema: dict | None = SCENE_SCHEMA,
) -> dict | str:
    """Send one prompt plus every frame of a chunk in a single request.

    All frames go in one message so the model sees the chunk as a continuous
    sequence and can describe movement across it, rather than judging each
    frame in isolation.

    With `schema` (the default) the reply is parsed structured output and a
    dict comes back; pass `schema=None` for plain prose.
    """
    if not frames:
        return {} if schema else ""

    content = [{"type": "text", "text": prompt}]
    content.extend(
        {
            "type": "image_url",
            "image_url": {"url": _encode(frame, max_width, quality), "detail": detail},
        }
        for frame in frames
    )

    kwargs = {}
    if schema is not None:
        kwargs["response_format"] = {"type": "json_schema", "json_schema": schema}

    response = _get_client().chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        **kwargs,
    )
    text = response.choices[0].message.content.strip()
    return json.loads(text) if schema is not None else text
