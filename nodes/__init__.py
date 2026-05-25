from __future__ import annotations

from comfy_api.latest import ComfyExtension
from typing_extensions import override

from .studio import GeminiCinematicLightingNode


class GeminiCinematicLightingExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [
            GeminiCinematicLightingNode,
        ]


async def comfy_entrypoint():
    return GeminiCinematicLightingExtension()