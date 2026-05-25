"""Content-locked relighting transfer for Flux image-edit results."""

from __future__ import annotations

import logging

import torch
import torch.nn.functional as F
from comfy_api.latest import io


NODE_ID = "QwenPreserveOriginalRelightingNode"
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


class QwenPreserveOriginalRelightingNode(io.ComfyNode):
    """Apply Flux-proposed illumination while retaining the source image structure."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id=NODE_ID,
            display_name="Preserve Original Relighting (Flux Lock)",
            category="qwen/cinematic-lighting",
            description=(
                "Uses the original image as the only content source and transfers only a smooth "
                "illumination field from a Flux relighting proposal."
            ),
            inputs=[
                io.Image.Input("original_image", display_name="Original Image (Content Lock)"),
                io.Image.Input("flux_relight_image", display_name="Flux Relight Proposal"),
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
            ],
            outputs=[
                io.Image.Output("image", display_name="Structure-Locked Relight Image"),
            ],
        )

    @classmethod
    def execute(cls, **kwargs) -> io.NodeOutput:
        original_image = kwargs.get("original_image")
        flux_image = kwargs.get("flux_relight_image")
        if not isinstance(original_image, torch.Tensor) or not isinstance(flux_image, torch.Tensor):
            raise RuntimeError("Original Image and Flux Relight Proposal are required.")
        if original_image.ndim != 4 or flux_image.ndim != 4:
            raise RuntimeError("Expected ComfyUI IMAGE tensors in batch-height-width-channel format.")
        if original_image.shape[-1] < 3 or flux_image.shape[-1] < 3:
            raise RuntimeError("Relighting requires RGB image inputs.")

        strength = float(kwargs.get("lighting_strength", 1.0))
        if strength <= 0.0:
            return io.NodeOutput(original_image)

        source = original_image[..., :3].to(dtype=torch.float32).clamp(0.0, 1.0)
        proposal = flux_image[..., :3].to(device=source.device, dtype=torch.float32).clamp(0.0, 1.0)
        if proposal.shape[0] != source.shape[0]:
            if proposal.shape[0] == 1:
                proposal = proposal.expand(source.shape[0], -1, -1, -1)
            else:
                raise RuntimeError("Flux proposal batch must match the original image batch.")
        if proposal.shape[1:3] != source.shape[1:3]:
            proposal = F.interpolate(
                proposal.movedim(-1, 1),
                size=source.shape[1:3],
                mode="bicubic",
                align_corners=False,
            ).movedim(1, -1).clamp(0.0, 1.0)

        source_linear = _srgb_to_linear(source).movedim(-1, 1)
        proposal_linear = _srgb_to_linear(proposal).movedim(-1, 1)
        radius = int(kwargs.get("structure_lock_radius", 64))
        source_field = _lighting_field(source_linear, radius)
        proposal_field = _lighting_field(proposal_linear, radius)
        transfer_color = bool(kwargs.get("transfer_light_color", False))
        if not transfer_color:
            weights = source_linear.new_tensor(_LUMA_WEIGHTS).reshape(1, 3, 1, 1)
            source_field = (source_field * weights).sum(dim=1, keepdim=True)
            proposal_field = (proposal_field * weights).sum(dim=1, keepdim=True)

        epsilon = 1e-4
        max_stops = max(0.1, float(kwargs.get("max_exposure_stops", 1.25)))
        exposure_stops = torch.log2((proposal_field + epsilon) / (source_field + epsilon))
        exposure_stops = exposure_stops.clamp(-max_stops, max_stops) * max(0.0, min(strength, 1.0))
        gain = torch.pow(2.0, exposure_stops)
        relit_linear = (source_linear * gain).clamp(0.0, 1.0)
        result = _linear_to_srgb(relit_linear).movedim(1, -1).clamp(0.0, 1.0)
        LOGGER.info(
            "[Flux Lock] Applied low-frequency %s relighting onto original image at radius %d.",
            "color and luminance" if transfer_color else "luminance-only",
            radius,
        )
        return io.NodeOutput(result.to(dtype=original_image.dtype))
