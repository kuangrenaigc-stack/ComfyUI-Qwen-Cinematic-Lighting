"""ComfyUI-Gemini-Cinematic-Lighting v3.6.1

A single-node lighting-only Gemini expert with integrated Flux content locking.
"""

from __future__ import annotations

import os

import nodes

custom_node_dir = os.path.dirname(os.path.realpath(__file__))
web_dir = os.path.join(custom_node_dir, "web", "js")

if os.path.isdir(web_dir):
    nodes.EXTENSION_WEB_DIRS["ComfyUI-Gemini-Cinematic-Lighting"] = web_dir

from .nodes import comfy_entrypoint

__all__ = ["comfy_entrypoint"]
