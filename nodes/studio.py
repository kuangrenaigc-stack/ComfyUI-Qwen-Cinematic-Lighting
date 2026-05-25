"""Single-node lighting expert with Gemini vision analysis and CLIP conditioning."""

from __future__ import annotations

import json
import logging

from comfy_api.latest import io

from ..engine.gemini_lighting_expert import analyze_lighting_sync
from ..engine.lighting_system import LightingConfig, MAIN_MODIFIER_OPTIONS
from ..engine.prompt_compiler import PromptCompiler


NODE_ID = "QwenCinematicLightingWorkbenchNode"
LOGGER = logging.getLogger(__name__)


class QwenCinematicLightingStudioNode(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=NODE_ID,
            display_name="Gemini Lighting Expert",
            category="qwen/cinematic-lighting",
            description="Analyzes the source image with Gemini 3 Flash Preview and outputs CLIP conditioning for lighting-only optimization.",
            inputs=[
                io.Image.Input("image", display_name="Source Image"),
                io.Clip.Input("clip", display_name="CLIP"),
                io.String.Input("user_prompt", default="", multiline=True, display_name="Lighting Intent"),
                io.String.Input(
                    "gemini_api_key",
                    default="",
                    multiline=False,
                    placeholder="AIza...",
                    display_name="Gemini API Key",
                ),
                io.Int.Input("world_azimuth", default=315, min=0, max=360, step=1, display_name="Key Light Azimuth"),
                io.Float.Input("world_elevation", default=35, min=-20, max=90, step=1, display_name="Key Light Elevation"),
                io.Float.Input("world_distance", default=10.0, min=0.5, max=50.0, step=0.5, display_name="Key Light Distance (m)"),
                io.Float.Input("world_power", default=1.0, min=0.0, max=5.0, step=0.05, display_name="Key Light Power"),
                io.Float.Input("world_softbox", default=0.0, min=0.0, max=1.0, step=0.01, display_name="Key Light Softness"),
                io.Int.Input("world_color_temp", default=5600, min=1500, max=12000, step=50, display_name="Key Light Color Temp (K)"),
                io.Combo.Input("main_modifier", options=MAIN_MODIFIER_OPTIONS, default="none", display_name="Key Projection Attachment"),
                io.Float.Input("modifier_strength", default=0.0, min=0.0, max=1.0, step=0.01, display_name="Modifier Strength"),
                io.Float.Input("modifier_softness", default=0.35, min=0.0, max=1.0, step=0.01, display_name="Modifier Softness"),
                io.Float.Input("modifier_scale", default=1.0, min=0.05, max=5.0, step=0.05, display_name="Modifier Scale"),
                io.Float.Input("modifier_rotation", default=0.0, min=-180.0, max=180.0, step=1.0, display_name="Modifier Rotation"),
                io.Float.Input("sky_power", default=0.3, min=0.0, max=1.0, step=0.01, display_name="Diffuse Sky / Bounce Fill"),
                io.Boolean.Input("sky_auto_temp", default=True, display_name="Natural Open-Sky Fill Color"),
                io.Int.Input("sky_color_temp", default=6500, min=1500, max=12000, step=50, display_name="Manual Fill Color Temp (K)"),
                io.String.Input("aux_lights_json", default="[]", multiline=True, display_name="Three Supporting Lights JSON"),
            ],
            outputs=[
                io.Image.Output("image", display_name="Image"),
                io.Conditioning.Output("positive_conditioning", display_name="Positive Conditioning (CFG)"),
                io.Conditioning.Output("negative_conditioning", display_name="Negative Conditioning (CFG)"),
                io.String.Output("positive_prompt", display_name="Positive Prompt"),
                io.String.Output("negative_prompt", display_name="Negative Prompt"),
                io.String.Output("lighting_metadata_json", display_name="Lighting Metadata JSON"),
                io.String.Output("expert_report_json", display_name="Gemini Expert Report JSON"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        image = kwargs.get("image")
        clip = kwargs.get("clip")
        if clip is None:
            raise RuntimeError("A valid CLIP input is required to create CFG conditioning.")

        LOGGER.info("[Gemini Lighting Expert] Executing relighting analysis and CFG conditioning node.")
        config = LightingConfig.from_kwargs(**kwargs)
        lighting_intent = str(kwargs.get("user_prompt") or "").strip()
        expert_result = analyze_lighting_sync(
            image,
            config.to_dict(),
            lighting_intent,
            api_key=str(kwargs.get("gemini_api_key") or "").strip(),
        )
        positive, negative, metadata = PromptCompiler().compile(
            config,
            expert_result=expert_result,
            lighting_intent=lighting_intent,
            use_weights=True,
        )

        positive_conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(positive))
        negative_conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(negative))
        LOGGER.info(
            "[Gemini Lighting Expert] CFG conditioning ready; lighting analysis mode: %s.",
            "Gemini" if expert_result.get("analyzed") else "manual fallback",
        )
        return io.NodeOutput(
            image,
            positive_conditioning,
            negative_conditioning,
            positive,
            negative,
            metadata,
            json.dumps(expert_result, ensure_ascii=False, sort_keys=True),
        )
