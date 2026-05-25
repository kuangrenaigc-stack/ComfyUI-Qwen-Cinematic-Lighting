"""Single-node Gemini lighting expert with integrated Flux relighting and content lock."""

from __future__ import annotations

import json
import logging

import comfy.model_management
import comfy.samplers
import node_helpers
import torch
import torch.nn.functional as F
from comfy_api.latest import io
from comfy_extras.nodes_custom_sampler import SamplerCustom
from comfy_extras.nodes_flux import Flux2Scheduler
from comfy_extras.nodes_post_processing import ImageScaleToTotalPixels

from ..engine.gemini_lighting_expert import analyze_lighting_sync
from ..engine.lighting_system import LightingConfig, MAIN_MODIFIER_OPTIONS
from ..engine.prompt_compiler import PromptCompiler


NODE_ID = "QwenCinematicLightingWorkbenchNode"
LOGGER = logging.getLogger(__name__)
_LUMA_WEIGHTS = (0.2126, 0.7152, 0.0722)


def _srgb_to_linear(image: torch.Tensor) -> torch.Tensor:
    return torch.where(
        image <= 0.04045,
        image / 12.92,
        torch.pow((image + 0.055) / 1.055, 2.4),
    )


def _linear_to_srgb(image: torch.Tensor) -> torch.Tensor:
    return torch.where(
        image <= 0.0031308,
        image * 12.92,
        1.055 * torch.pow(image.clamp_min(0.0), 1.0 / 2.4) - 0.055,
    )


def _gaussian_blur(image: torch.Tensor, radius: int) -> torch.Tensor:
    max_radius = max(1, min(image.shape[-2:]) // 3)
    radius = min(max(1, int(radius)), max_radius)
    sigma = max(radius / 3.0, 0.5)
    coords = torch.arange(-radius, radius + 1, device=image.device, dtype=image.dtype)
    kernel = torch.exp(-(coords.square()) / (2.0 * sigma * sigma))
    kernel = kernel / kernel.sum()
    channels = image.shape[1]
    horizontal = kernel.reshape(1, 1, 1, -1).expand(channels, 1, 1, -1)
    vertical = kernel.reshape(1, 1, -1, 1).expand(channels, 1, -1, 1)
    blurred = F.conv2d(F.pad(image, (radius, radius, 0, 0), mode="replicate"), horizontal, groups=channels)
    return F.conv2d(F.pad(blurred, (0, 0, radius, radius), mode="replicate"), vertical, groups=channels)


def _lighting_field(image: torch.Tensor, radius: int) -> torch.Tensor:
    height, width = image.shape[-2:]
    scale = min(1.0, 512.0 / float(max(height, width)))
    if scale < 1.0:
        sampled = F.interpolate(
            image,
            size=(max(1, round(height * scale)), max(1, round(width * scale))),
            mode="area",
        )
    else:
        sampled = image
    field = _gaussian_blur(sampled, max(1, round(radius * scale)))
    if field.shape[-2:] != (height, width):
        field = F.interpolate(field, size=(height, width), mode="bicubic", align_corners=False)
    return field.clamp_min(0.0)


def _apply_structure_lock(
    original_image: torch.Tensor,
    flux_image: torch.Tensor,
    lighting_strength: float,
    structure_lock_radius: int,
    max_exposure_stops: float,
    transfer_light_color: bool,
) -> torch.Tensor:
    if lighting_strength <= 0.0:
        return original_image
    source = original_image[..., :3].to(dtype=torch.float32).clamp(0.0, 1.0)
    proposal = flux_image[..., :3].to(device=source.device, dtype=torch.float32).clamp(0.0, 1.0)
    if proposal.shape[0] != source.shape[0]:
        if proposal.shape[0] == 1:
            proposal = proposal.expand(source.shape[0], -1, -1, -1)
        else:
            raise RuntimeError("Flux output batch must match the original image batch.")
    if proposal.shape[1:3] != source.shape[1:3]:
        proposal = F.interpolate(
            proposal.movedim(-1, 1),
            size=source.shape[1:3],
            mode="bicubic",
            align_corners=False,
        ).movedim(1, -1).clamp(0.0, 1.0)

    source_linear = _srgb_to_linear(source).movedim(-1, 1)
    proposal_linear = _srgb_to_linear(proposal).movedim(-1, 1)
    source_field = _lighting_field(source_linear, structure_lock_radius)
    proposal_field = _lighting_field(proposal_linear, structure_lock_radius)
    if not transfer_light_color:
        weights = source_linear.new_tensor(_LUMA_WEIGHTS).reshape(1, 3, 1, 1)
        source_field = (source_field * weights).sum(dim=1, keepdim=True)
        proposal_field = (proposal_field * weights).sum(dim=1, keepdim=True)

    epsilon = 1e-4
    max_stops = max(0.1, float(max_exposure_stops))
    exposure_stops = torch.log2((proposal_field + epsilon) / (source_field + epsilon))
    exposure_stops = exposure_stops.clamp(-max_stops, max_stops) * max(0.0, min(float(lighting_strength), 1.0))
    relit_linear = (source_linear * torch.pow(2.0, exposure_stops)).clamp(0.0, 1.0)
    result = _linear_to_srgb(relit_linear).movedim(1, -1).clamp(0.0, 1.0)
    return result.to(dtype=original_image.dtype)


def _resize_source_image(image: torch.Tensor, upscale_method: str, megapixels: float) -> torch.Tensor:
    return ImageScaleToTotalPixels.execute(
        image,
        str(upscale_method or "nearest-exact"),
        max(0.01, min(float(megapixels), 16.0)),
        1,
    ).result[0]


def _prepare_reference_conditioning(vae, source_image: torch.Tensor, positive_conditioning, negative_conditioning):
    reference_samples = vae.encode(source_image)
    reference_values = {"reference_latents": [reference_samples]}
    positive = node_helpers.conditioning_set_values(positive_conditioning, reference_values, append=True)
    negative = node_helpers.conditioning_set_values(negative_conditioning, reference_values, append=True)
    return positive, negative


def _generate_flux_proposal(
    model,
    vae,
    source_image: torch.Tensor,
    positive_conditioning,
    negative_conditioning,
    *,
    sampler_name: str,
    steps: int,
    noise_seed: int,
    cfg: float,
) -> torch.Tensor:
    height = max(16, (int(source_image.shape[1]) // 16) * 16)
    width = max(16, (int(source_image.shape[2]) // 16) * 16)
    batch_size = int(source_image.shape[0])
    initial_latent = {
        "samples": torch.zeros(
            [batch_size, 128, height // 16, width // 16],
            device=comfy.model_management.intermediate_device(),
        )
    }
    sigmas = Flux2Scheduler.execute(max(1, int(steps)), width, height).result[0]
    sampler = comfy.samplers.sampler_object(str(sampler_name or "euler"))
    sampled = SamplerCustom.execute(
        model,
        True,
        int(noise_seed),
        float(cfg),
        positive_conditioning,
        negative_conditioning,
        sampler,
        sigmas,
        initial_latent,
    ).result[0]
    samples = sampled["samples"]
    if getattr(samples, "is_nested", False):
        samples = samples.unbind()[0]
    return vae.decode(samples)


class QwenCinematicLightingStudioNode(io.ComfyNode):

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=NODE_ID,
            display_name="Gemini Lighting Expert",
            category="qwen/cinematic-lighting",
            description=(
                "Analyzes the source image, performs Flux relighting internally, and returns a "
                "structure-locked image whose content is always derived from the original."
            ),
            inputs=[
                io.Image.Input("image", display_name="Source Image"),
                io.Model.Input("model", display_name="Flux Model"),
                io.Clip.Input("clip", display_name="CLIP"),
                io.Vae.Input("vae", display_name="VAE"),
                io.String.Input("user_prompt", default="", multiline=True, display_name="Lighting Intent"),
                io.String.Input(
                    "gemini_api_key",
                    default="",
                    multiline=False,
                    placeholder="AIza...",
                    display_name="Gemini API Key",
                ),
                io.Combo.Input(
                    "resize_method",
                    options=ImageScaleToTotalPixels.upscale_methods,
                    default="nearest-exact",
                    display_name="Output Resize Method",
                ),
                io.Float.Input(
                    "output_megapixels",
                    default=4.0,
                    min=0.01,
                    max=16.0,
                    step=0.01,
                    display_name="Output Resolution (MP)",
                ),
                io.Combo.Input("sampler_name", options=comfy.samplers.SAMPLER_NAMES, default="euler", display_name="Flux Sampler"),
                io.Int.Input("steps", default=4, min=1, max=100, step=1, display_name="Flux Steps"),
                io.Int.Input(
                    "noise_seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                    display_name="Flux Seed",
                ),
                io.Float.Input("cfg", default=1.0, min=0.0, max=100.0, step=0.1, display_name="Flux CFG"),
                io.Float.Input(
                    "lighting_strength",
                    default=1.0,
                    min=0.0,
                    max=1.0,
                    step=0.01,
                    display_name="Lighting Transfer Strength",
                ),
                io.Int.Input(
                    "structure_lock_radius",
                    default=64,
                    min=4,
                    max=256,
                    step=1,
                    display_name="Structure Lock Radius",
                ),
                io.Float.Input(
                    "max_exposure_stops",
                    default=1.25,
                    min=0.10,
                    max=4.0,
                    step=0.05,
                    display_name="Max Exposure Change (Stops)",
                ),
                io.Boolean.Input(
                    "transfer_light_color",
                    default=False,
                    display_name="Transfer Low-Frequency Light Color",
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
                io.Image.Output("image", display_name="Protected Relit Image"),
                io.Conditioning.Output("positive_conditioning", display_name="Positive Conditioning (CFG)"),
                io.Conditioning.Output("negative_conditioning", display_name="Negative Conditioning (CFG)"),
                io.String.Output("lighting_metadata_json", display_name="Lighting Metadata JSON"),
                io.String.Output("expert_report_json", display_name="Gemini Expert Report JSON"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        image = kwargs.get("image")
        model = kwargs.get("model")
        clip = kwargs.get("clip")
        vae = kwargs.get("vae")
        if image is None or model is None or clip is None or vae is None:
            raise RuntimeError("Source Image, Flux Model, CLIP, and VAE inputs are required.")

        LOGGER.info("[Gemini Lighting Expert] Executing integrated Flux relighting with original-image structure lock.")
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
            use_weights=False,
        )

        positive_conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(positive))
        negative_conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(negative))
        working_image = _resize_source_image(
            image,
            str(kwargs.get("resize_method") or "nearest-exact"),
            float(kwargs.get("output_megapixels", 4.0)),
        )
        positive_conditioning, negative_conditioning = _prepare_reference_conditioning(
            vae,
            working_image,
            positive_conditioning,
            negative_conditioning,
        )
        flux_proposal = _generate_flux_proposal(
            model,
            vae,
            working_image,
            positive_conditioning,
            negative_conditioning,
            sampler_name=str(kwargs.get("sampler_name") or "euler"),
            steps=int(kwargs.get("steps", 4)),
            noise_seed=int(kwargs.get("noise_seed", 0)),
            cfg=float(kwargs.get("cfg", 1.0)),
        )
        protected_image = _apply_structure_lock(
            working_image,
            flux_proposal,
            float(kwargs.get("lighting_strength", 1.0)),
            int(kwargs.get("structure_lock_radius", 64)),
            float(kwargs.get("max_exposure_stops", 1.25)),
            bool(kwargs.get("transfer_light_color", False)),
        )
        metadata_data = json.loads(metadata)
        metadata_data["integrated_flux"] = {
            "resize_method": str(kwargs.get("resize_method") or "nearest-exact"),
            "output_megapixels": float(kwargs.get("output_megapixels", 4.0)),
            "output_width": int(working_image.shape[2]),
            "output_height": int(working_image.shape[1]),
            "sampler_name": str(kwargs.get("sampler_name") or "euler"),
            "steps": int(kwargs.get("steps", 4)),
            "cfg": float(kwargs.get("cfg", 1.0)),
            "structure_lock_radius": int(kwargs.get("structure_lock_radius", 64)),
            "lighting_strength": float(kwargs.get("lighting_strength", 1.0)),
            "max_exposure_stops": float(kwargs.get("max_exposure_stops", 1.25)),
            "transfer_light_color": bool(kwargs.get("transfer_light_color", False)),
        }
        metadata = json.dumps(metadata_data, ensure_ascii=False, sort_keys=True)
        LOGGER.info(
            "[Gemini Lighting Expert] Protected Flux relight ready; lighting analysis mode: %s.",
            "Gemini" if expert_result.get("analyzed") else "manual fallback",
        )
        return io.NodeOutput(
            protected_image,
            positive_conditioning,
            negative_conditioning,
            metadata,
            json.dumps(expert_result, ensure_ascii=False, sort_keys=True),
        )
