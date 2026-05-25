"""Lighting-only data model for the Gemini cinematic lighting workbench."""

from __future__ import annotations

import json as _json
from dataclasses import dataclass, field
from typing import Any

from .cinematic_logic import clamp, normalize_angle


AUX_COUNT = 3
AUX_DEFAULT_LABELS = ["Fill 补光", "Rim 轮廓光", "Back 背光"]
AUX_ROLE_DEFAULTS = [
    {"azimuth": 45, "elevation": 20, "distance": 4.0, "power": 0.25, "color_temp": 5600, "softbox": 0.70, "beam_angle": 90},
    {"azimuth": 135, "elevation": 35, "distance": 4.0, "power": 0.45, "color_temp": 5600, "softbox": 0.15, "beam_angle": 30},
    {"azimuth": 180, "elevation": 40, "distance": 5.0, "power": 0.50, "color_temp": 5600, "softbox": 0.15, "beam_angle": 35},
]
MAIN_MODIFIER_OPTIONS = [
    "none",
    "blinds",
    "window_frame",
    "lattice",
    "foliage",
    "caustics",
    "stained_glass",
]
LEGACY_MODIFIER_ALIASES = {
    "bamboo": "foliage",
    "palm_leaf": "foliage",
    "geometric_shadow": "lattice",
}


def _number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    return clamp(value, fallback, minimum, maximum)


def _angle(value: Any, fallback: float = 0.0) -> int:
    try:
        return normalize_angle(float(value))
    except (TypeError, ValueError):
        return normalize_angle(fallback)


def _boolean(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes", "on"}:
            return True
        if text in {"false", "0", "no", "off"}:
            return False
    if value is None:
        return fallback
    return bool(value)


@dataclass
class WorldLight:
    """Primary virtual light used to reshape existing illumination."""

    azimuth: float = 315.0
    elevation: float = 35.0
    distance: float = 10.0
    power: float = 1.0
    softbox: float = 0.0
    color_temp: int = 5600

    def to_dict(self) -> dict[str, Any]:
        return {
            "azimuth": round(self.azimuth, 1),
            "elevation": round(self.elevation, 1),
            "distance": round(self.distance, 2),
            "power": round(self.power, 3),
            "softbox": round(self.softbox, 3),
            "color_temp": self.color_temp,
        }

    @classmethod
    def from_kwargs(cls, **kwargs: Any) -> "WorldLight":
        return cls(
            azimuth=_angle(kwargs.get("world_azimuth", 315), 315),
            elevation=_number(kwargs.get("world_elevation", 35), 35, -20, 90),
            distance=_number(kwargs.get("world_distance", 10), 10, 0.5, 50),
            power=_number(kwargs.get("world_power", 1.0), 1.0, 0.0, 5.0),
            softbox=_number(kwargs.get("world_softbox", 0.0), 0.0, 0.0, 1.0),
            color_temp=int(_number(kwargs.get("world_color_temp", 5600), 5600, 1500, 12000)),
        )


@dataclass
class SkyLight:
    """Diffuse sky/bounce fill used to control shadow openness and ambient color."""

    power: float = 0.3
    color_temp: int = 6500
    auto_temp: bool = True

    def effective_temp(self, world_temp: int) -> int:
        if not self.auto_temp:
            return self.color_temp
        # Auto mode models open-sky fill: diffuse ambience generally reads cooler
        # than a key, especially beside a warm practical/tungsten key.
        if world_temp < 4500:
            return 6500
        return min(8500, max(6000, world_temp + 800))

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": "environment_fill",
            "power": round(self.power, 3),
            "color_temp": self.color_temp,
            "auto_temp": self.auto_temp,
        }

    @classmethod
    def from_kwargs(cls, **kwargs: Any) -> "SkyLight":
        return cls(
            power=_number(kwargs.get("sky_power", 0.3), 0.3, 0.0, 1.0),
            color_temp=int(_number(kwargs.get("sky_color_temp", 6500), 6500, 1500, 12000)),
            auto_temp=_boolean(kwargs.get("sky_auto_temp", True), True),
        )


@dataclass
class MainLightModifier:
    """Off-frame modifier applied to the primary light."""

    modifier_type: str = "none"
    strength: float = 0.0
    softness: float = 0.35
    scale: float = 1.0
    rotation: float = 0.0

    @property
    def enabled(self) -> bool:
        return self.modifier_type != "none" and self.strength > 0.001

    def to_dict(self) -> dict[str, Any]:
        return {
            "modifier_type": self.modifier_type,
            "enabled": self.enabled,
            "applies_to": "world_light",
            "strength": round(self.strength, 3),
            "softness": round(self.softness, 3),
            "scale": round(self.scale, 3),
            "rotation": round(self.rotation, 1),
        }

    @classmethod
    def from_kwargs(cls, **kwargs: Any) -> "MainLightModifier":
        modifier_type = str(kwargs.get("main_modifier", "none") or "none")
        modifier_type = LEGACY_MODIFIER_ALIASES.get(modifier_type, modifier_type)
        if modifier_type not in MAIN_MODIFIER_OPTIONS:
            modifier_type = "none"
        default_strength = 0.0 if modifier_type == "none" else 0.65
        return cls(
            modifier_type=modifier_type,
            strength=_number(kwargs.get("modifier_strength", default_strength), default_strength, 0.0, 1.0),
            softness=_number(kwargs.get("modifier_softness", 0.35), 0.35, 0.0, 1.0),
            scale=_number(kwargs.get("modifier_scale", 1.0), 1.0, 0.05, 5.0),
            rotation=_number(kwargs.get("modifier_rotation", 0.0), 0.0, -180.0, 180.0),
        )


@dataclass
class AuxLight:
    """One of three supporting lights: fill, rim, or back light."""

    enabled: bool = False
    label: str = ""
    azimuth: float = 0.0
    elevation: float = 0.0
    distance: float = 3.0
    power: float = 0.5
    color_temp: int = 3200
    softbox: float = 0.0
    beam_angle: float = 45.0

    def to_dict(self) -> dict[str, Any]:
        if not self.enabled:
            return {"enabled": False, "label": self.label}
        return {
            "enabled": True,
            "label": self.label,
            "azimuth": round(self.azimuth, 1),
            "elevation": round(self.elevation, 1),
            "distance": round(self.distance, 2),
            "power": round(self.power, 3),
            "color_temp": self.color_temp,
            "softbox": round(self.softbox, 3),
            "beam_angle": round(self.beam_angle, 1),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any], index: int = 0) -> "AuxLight":
        default_label = AUX_DEFAULT_LABELS[index] if index < AUX_COUNT else f"Aux {index + 1}"
        defaults = AUX_ROLE_DEFAULTS[index] if index < AUX_COUNT else AUX_ROLE_DEFAULTS[0]
        data = data if isinstance(data, dict) else {}
        return cls(
            enabled=_boolean(data.get("enabled", False), False),
            label=str(data.get("label", default_label)),
            azimuth=_angle(data.get("azimuth", defaults["azimuth"]), defaults["azimuth"]),
            elevation=_number(data.get("elevation", defaults["elevation"]), defaults["elevation"], -20, 90),
            distance=_number(data.get("distance", defaults["distance"]), defaults["distance"], 0.5, 20.0),
            power=_number(data.get("power", defaults["power"]), defaults["power"], 0.0, 1.0),
            color_temp=int(_number(data.get("color_temp", defaults["color_temp"]), defaults["color_temp"], 1500, 12000)),
            softbox=_number(data.get("softbox", defaults["softbox"]), defaults["softbox"], 0.0, 1.0),
            beam_angle=_number(data.get("beam_angle", defaults["beam_angle"]), defaults["beam_angle"], 5.0, 120.0),
        )


@dataclass
class LightingConfig:
    """A lighting-only edit configuration for a source image."""

    world_light: WorldLight = field(default_factory=WorldLight)
    sky_light: SkyLight = field(default_factory=SkyLight)
    main_modifier: MainLightModifier = field(default_factory=MainLightModifier)
    aux_lights: list[AuxLight] = field(
        default_factory=lambda: [AuxLight.from_dict({}, i) for i in range(AUX_COUNT)]
    )

    @property
    def active_aux_lights(self) -> list[AuxLight]:
        return [light for light in self.aux_lights if light.enabled]

    def sky_effective_temp(self) -> int:
        return self.sky_light.effective_temp(self.world_light.color_temp)

    def to_dict(self) -> dict[str, Any]:
        return {
            "world_light": self.world_light.to_dict(),
            "sky_light": self.sky_light.to_dict(),
            "sky_effective_temp": self.sky_effective_temp(),
            "main_modifier": self.main_modifier.to_dict(),
            "aux_lights": [light.to_dict() for light in self.aux_lights],
            "active_aux_count": len(self.active_aux_lights),
        }

    @classmethod
    def from_kwargs(cls, **kwargs: Any) -> "LightingConfig":
        aux_list: list[dict[str, Any]] = []
        try:
            parsed = _json.loads(str(kwargs.get("aux_lights_json", "[]") or "[]"))
            if isinstance(parsed, list):
                aux_list = [item if isinstance(item, dict) else {} for item in parsed[:AUX_COUNT]]
        except _json.JSONDecodeError:
            pass
        return cls(
            world_light=WorldLight.from_kwargs(**kwargs),
            sky_light=SkyLight.from_kwargs(**kwargs),
            main_modifier=MainLightModifier.from_kwargs(**kwargs),
            aux_lights=[
                AuxLight.from_dict(aux_list[index] if index < len(aux_list) else {}, index)
                for index in range(AUX_COUNT)
            ],
        )
