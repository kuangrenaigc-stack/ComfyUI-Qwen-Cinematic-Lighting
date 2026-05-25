from __future__ import annotations

from comfy_api.latest import ComfyExtension
from typing_extensions import override

from .studio import QwenCinematicLightingStudioNode


class QwenCinematicLightingExtension(ComfyExtension):
    @override
    async def get_node_list(self):
        return [
            QwenCinematicLightingStudioNode,
        ]


async def comfy_entrypoint():
    return QwenCinematicLightingExtension()
