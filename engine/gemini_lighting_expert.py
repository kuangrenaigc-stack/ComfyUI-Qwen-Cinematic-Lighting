"""Gemini visual lighting analysis for the lighting-only workbench."""

from __future__ import annotations

import base64
from io import BytesIO
import json
import logging
import os
import time
from typing import Any
import urllib.error
import urllib.request

from PIL import Image


LOGGER = logging.getLogger(__name__)
GEMINI_MODEL = "gemini-3-flash-preview"
GEMINI_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)
SYSTEM_INSTRUCTION = """You are a senior film lighting designer specializing in image relighting.
Analyze the supplied original image before proposing a lighting improvement.
Your goal is to improve only illumination, shadow shape, depth separation, and motivated ambient fill.
Keep the subject identity, expression, pose, clothing, composition, background, geometry, props, and
camera perspective unchanged. Never propose a new visible window, lamp, object, lens, film stock,
camera model, crop, or global restyle.
Every proposed effect must be achievable in real photography with off-frame key/fill/rim/back lights,
soft diffusion or bounce, flags, or a focused key-light gobo/projection attachment. Diffuse sky or
bounce fill may open shadows but must not create a sharp independent shadow direction. A readable
patterned projection requires a focused harder light; with a broad soft source it must become only a
softened light breakup. Treat water-ripple or colored-glass projection settings only as off-frame
lighting effects: never invent water, wet surfaces, stained-glass windows, or new architecture.

Return JSON only in this exact structure:
{
  "assessment": "brief diagnosis of the existing light and the best lighting strategy",
  "positive_clauses": ["short image-generation prompt clauses describing the improved light"],
  "negative_clauses": ["short constraints preventing unwanted lighting/content changes"]
}
Use no more than 6 positive clauses and 6 negative clauses."""


def _image_to_jpeg_base64(image: Any) -> str | None:
    if image is None or not hasattr(image, "shape"):
        return None
    try:
        frame = image[0] if len(image.shape) == 4 else image
        array = (frame.detach().cpu().numpy() * 255.0).clip(0, 255).astype("uint8")
        pil_image = Image.fromarray(array).convert("RGB")
        pil_image.thumbnail((1536, 1536))
        buffer = BytesIO()
        pil_image.save(buffer, format="JPEG", quality=92, optimize=True)
        return base64.b64encode(buffer.getvalue()).decode("ascii")
    except Exception:
        return None


def _parse_json_text(text: str) -> dict[str, Any] | None:
    content = str(text or "").strip()
    if content.startswith("```"):
        content = content.strip("`").strip()
        if content.lower().startswith("json"):
            content = content[4:].strip()
    try:
        value = json.loads(content)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _clauses(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip()[:300] for item in value[:6] if str(item).strip()]


def _response_text(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    candidates = data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    content = candidates[0].get("content") if isinstance(candidates[0], dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if not isinstance(parts, list):
        return ""
    return "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))


def analyze_lighting_sync(
    image: Any,
    config: dict[str, Any],
    lighting_intent: str = "",
    api_key: str = "",
) -> dict[str, Any]:
    """Return Gemini's visual relighting proposal or a local fallback status."""

    result: dict[str, Any] = {
        "model": GEMINI_MODEL,
        "analyzed": False,
        "assessment": "",
        "positive_clauses": [],
        "negative_clauses": [],
    }
    api_key = str(api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
    if not api_key:
        result["status"] = "No Gemini API key was provided; using manual lighting rules."
        LOGGER.info("[Gemini Lighting Expert] Gemini skipped: no API key provided; using manual lighting rules.")
        return result
    image_data = _image_to_jpeg_base64(image)
    if not image_data:
        result["status"] = "No readable source image was provided for Gemini analysis."
        LOGGER.info("[Gemini Lighting Expert] Gemini skipped: no readable source image was provided.")
        return result

    intent = " ".join(str(lighting_intent or "").split())[:600]
    started_at = time.perf_counter()
    LOGGER.info(
        "[Gemini Lighting Expert] Sending source image to %s for visual lighting analysis.",
        GEMINI_MODEL,
    )
    prompt = (
        "Review this source image and propose the most natural, effective relighting treatment. "
        "The virtual light controls currently selected by the user are included below; respect them "
        "when they are intentional, but improve their interpretation for the actual image.\n\n"
        f"Lighting intent: {intent or 'natural cinematic lighting optimization'}\n"
        f"Configured light rig: {json.dumps(config, ensure_ascii=False)}"
    )
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_INSTRUCTION}]},
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {"inline_data": {"mime_type": "image/jpeg", "data": image_data}},
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.25,
            "maxOutputTokens": 800,
            "responseMimeType": "application/json",
        },
    }
    request = urllib.request.Request(
        GEMINI_API_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            data = json.loads(response.read().decode("utf-8"))
        text = _response_text(data)
        parsed = _parse_json_text(text)
        if not parsed:
            raise ValueError("Gemini returned non-JSON lighting analysis.")
        result.update(
            {
                "analyzed": True,
                "status": "Gemini lighting analysis applied.",
                "assessment": str(parsed.get("assessment", "")).strip()[:1000],
                "positive_clauses": _clauses(parsed.get("positive_clauses")),
                "negative_clauses": _clauses(parsed.get("negative_clauses")),
            }
        )
        LOGGER.info(
            "[Gemini Lighting Expert] Gemini lighting analysis applied in %.2f seconds.",
            time.perf_counter() - started_at,
        )
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace").replace("\n", " ")[:240]
        except Exception:
            pass
        result["status"] = f"Gemini request failed (HTTP {exc.code}); using manual lighting rules."
        LOGGER.warning(
            "[Gemini Lighting Expert] Gemini request failed after %.2f seconds (HTTP %s)%s; using manual lighting rules.",
            time.perf_counter() - started_at,
            exc.code,
            f": {detail}" if detail else "",
        )
    except Exception as exc:
        message = str(exc).replace("\n", " ")[:180]
        result["status"] = f"Gemini analysis unavailable; using manual lighting rules ({type(exc).__name__})."
        LOGGER.warning(
            "[Gemini Lighting Expert] Gemini analysis unavailable after %.2f seconds (%s%s); using manual lighting rules.",
            time.perf_counter() - started_at,
            type(exc).__name__,
            f": {message}" if message else "",
        )
    return result
