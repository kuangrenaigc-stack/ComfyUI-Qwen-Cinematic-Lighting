"""ComfyUI-Qwen-Cinematic-Lighting v3.0

A lighting-only Gemini expert for ComfyUI with CLIP conditioning output.
"""

from __future__ import annotations

import os

import nodes

custom_node_dir = os.path.dirname(os.path.realpath(__file__))
web_dir = os.path.join(custom_node_dir, "web", "js")

if os.path.isdir(web_dir):
    nodes.EXTENSION_WEB_DIRS["ComfyUI-Qwen-Cinematic-Lighting"] = web_dir

from .nodes import comfy_entrypoint

__all__ = ["comfy_entrypoint"]
