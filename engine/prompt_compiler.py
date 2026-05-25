"""Compile lighting controls and Gemini analysis into relighting prompts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .cinematic_logic import (
    describe_azimuth,
    describe_distance,
    describe_elevation,
    describe_temperature,
)
from .lighting_system import AuxLight, LightingConfig, SkyLight, WorldLight
from .metadata_schema import dump_state


@dataclass(frozen=True)
class PromptClause:
    text: str
    weight: float = 1.0
    category: str = "lighting"

    def render(self, use_weights: bool = True) -> str:
        text = self.text.strip()
        if not text:
            return ""
        if use_weights and abs(self.weight - 1.0) > 0.01:
            return f"({text}:{self.weight:.2f})"
        return text


def _softbox_desc(softbox: float) -> str:
    if softbox >= 0.70:
        return "large soft diffusion source with smooth shadow edges"
    if softbox >= 0.35:
        return "medium diffusion with readable shadow edges"
    if softbox > 0.05:
        return "light diffusion with subtly softened shadows"
    return "hard controlled source with crisp defined shadows"


def _beam_desc(angle: float) -> str:
    if angle <= 15:
        return "tight focused spot beam"
    if angle <= 30:
        return "narrow controlled beam"
    if angle <= 60:
        return "medium flood beam"
    if angle <= 90:
        return "wide flood coverage"
    return "very wide fill coverage"


_GOBO_PHRASES: dict[str, str] = {
    "blinds": "parallel venetian-stripe gobo shadow pattern",
    "window_frame": "rectangular window-frame gobo shadow projection",
    "lattice": "crisscross grille gobo shadow projection",
    "foliage": "organic dappled leaf gobo shadow pattern",
    "caustics": "projected water-ripple lighting texture",
    "stained_glass": "restrained multicolor effects-glass projection",
}
_GOBO_MOTIVATION: dict[str, str] = {
    "blinds": "neutral slatted breakup consistent with physical blinds or a metal gobo",
    "window_frame": "simple architectural frame shadow consistent with an off-frame window cutout",
    "lattice": "regular grille breakup consistent with a patterned metal gobo",
    "foliage": "irregular organic breakup consistent with a leaf-pattern breakup gobo",
    "caustics": "subtle projected ripple effect made with an effects gobo rather than added water",
    "stained_glass": "controlled colored illumination made with effects glass rather than added architecture",
}
_GOBO_NEGATIVE: dict[str, str] = {
    "blinds": "new visible blinds or window",
    "window_frame": "new visible window frame or architecture",
    "lattice": "new visible grille or fence",
    "foliage": "new leaves, branches, or plants",
    "caustics": "new water, wet surface, pool, or underwater environment",
    "stained_glass": "new stained-glass window or colored architecture",
}


def _gobo_desc(gobo: str) -> str:
    return _GOBO_PHRASES.get(gobo, "")


def _clean_intent(value: str) -> str:
    return " ".join(str(value or "").split())[:600]


_DIRECTION_LOCKS: dict[tuple[int, int], list[PromptClause]] = {
    (0, 45): [
        PromptClause("frontal key light on the existing subject, minimal side shadow", 1.16),
        PromptClause("do not reinterpret the key as backlight or side light", 1.14),
    ],
    (45, 90): [
        PromptClause("front-right three-quarter key, highlights on the subject right side", 1.18),
        PromptClause("subject left side remains gently darker", 1.14),
    ],
    (90, 135): [
        PromptClause("side light from subject right with strong directional separation", 1.22),
        PromptClause("brightest on subject right edge, left side in shadow", 1.18),
    ],
    (135, 225): [
        PromptClause("rear backlight producing controlled rim separation", 1.20),
        PromptClause("backlight does not globally brighten the front face", 1.16),
    ],
    (225, 270): [
        PromptClause("rear-left rim light grazing the existing subject edge", 1.20),
        PromptClause("front face should not become globally bright", 1.16),
    ],
    (270, 315): [
        PromptClause("side light from subject left with strong directional separation", 1.22),
        PromptClause("brightest on subject left edge, right side in shadow", 1.18),
    ],
    (315, 360): [
        PromptClause("front-left three-quarter key, highlights on the subject left side", 1.18),
        PromptClause("subject right side remains gently darker", 1.14),
    ],
}
AUX_LABELS = ["fill light", "rim light", "back light"]


def _direction_lock_clauses(azimuth: float) -> list[PromptClause]:
    value = int(round(float(azimuth))) % 360
    for (low, high), clauses in _DIRECTION_LOCKS.items():
        if low <= value < high:
            return clauses
    return _DIRECTION_LOCKS[(0, 45)]


class PromptCompiler:
    """Create prompts that alter light only, while keeping source content fixed."""

    def compile_world_light(self, light: WorldLight) -> list[PromptClause]:
        return [
            PromptClause("relight the existing image with a motivated primary key light", 1.22),
            PromptClause(describe_azimuth(light.azimuth), 1.10),
            PromptClause(describe_elevation(light.elevation), 1.06),
            PromptClause(describe_distance(light.distance), 0.98),
            PromptClause(f"controlled key-light intensity {light.power:.2f}", 1.02),
            PromptClause(describe_temperature(light.color_temp), 1.00),
            PromptClause(_softbox_desc(light.softbox), 1.06),
            *_direction_lock_clauses(light.azimuth),
        ]

    def compile_sky_light(self, light: SkyLight, effective_temp: int) -> list[PromptClause]:
        if light.power <= 0.001:
            return []
        source = (
            "soft diffuse open-sky and environmental bounce fill"
            if light.auto_temp
            else "soft diffuse motivated environmental bounce fill"
        )
        return [
            PromptClause(f"{source} opening existing shadows without adding a visible source", 1.04),
            PromptClause("diffuse fill lifts shadow detail without creating a new hard cast-shadow direction", 1.12),
            PromptClause(f"ambient fill strength {light.power:.2f}", 0.96),
            PromptClause(describe_temperature(effective_temp), 0.96),
        ]

    def compile_main_modifier(self, config: LightingConfig) -> list[PromptClause]:
        modifier = config.main_modifier
        description = _gobo_desc(modifier.modifier_type)
        if not modifier.enabled or not description:
            return []
        projection_softness = max(config.world_light.softbox, modifier.softness)
        if projection_softness <= 0.25:
            projection_character = "focused hard-light projection with readable, naturally defined edges"
        elif projection_softness <= 0.60:
            projection_character = "slightly defocused projection with soft but recognizable patterned edges"
        else:
            projection_character = "heavily diffused light breakup only, with no crisp projected pattern edges"
        return [
            PromptClause(
                f"{description} cast by an invisible off-frame modifier on the key light",
                1.10 + modifier.strength * 0.16,
            ),
            PromptClause(_GOBO_MOTIVATION[modifier.modifier_type], 1.12),
            PromptClause(
                (
                    f"shadow pattern strength {modifier.strength:.2f}, softness {modifier.softness:.2f}, "
                    f"scale {modifier.scale:.2f}x, rotation {modifier.rotation:.0f} degrees"
                ),
                0.96,
            ),
            PromptClause(projection_character, 1.18),
            PromptClause("do not add the modifier or a physical light source into the scene", 1.20),
        ]

    def compile_aux_light(self, light: AuxLight, index: int) -> list[PromptClause]:
        if not light.enabled:
            return []
        role = AUX_LABELS[index] if index < len(AUX_LABELS) else "supporting light"
        clauses = [
            PromptClause(f"supporting {role}: {describe_azimuth(light.azimuth)}", 1.02 + light.power * 0.06),
            PromptClause(f"{describe_elevation(light.elevation)}, distance {light.distance:.1f}m", 0.98),
            PromptClause(f"{describe_temperature(light.color_temp)}, power {light.power:.2f}", 0.98),
            PromptClause(_softbox_desc(light.softbox), 1.00),
            PromptClause(_beam_desc(light.beam_angle), 0.96),
        ]
        return clauses

    def preservation_clauses(self) -> list[PromptClause]:
        return [
            PromptClause("image-preserving relighting edit only, no content change", 1.30),
            PromptClause("preserve original subject identity, pose, outfit, composition, and scene layout", 1.26),
            PromptClause("keep existing background and geometry unchanged", 1.24),
            PromptClause("apply only physically plausible light direction, shadow shape, illumination and diffuse environmental fill", 1.28),
            PromptClause("do not add windows, lamps, props, or architectural objects", 1.28),
        ]

    def compile(
        self,
        config: LightingConfig,
        *,
        expert_result: dict[str, Any] | None = None,
        lighting_intent: str = "",
        use_weights: bool = True,
    ) -> tuple[str, str, str]:
        clauses = self.preservation_clauses()
        intent = _clean_intent(lighting_intent)
        if intent:
            clauses.append(PromptClause(f"requested lighting intent: {intent}", 1.0, "user_intent"))
        clauses.extend(self.compile_world_light(config.world_light))
        clauses.extend(self.compile_sky_light(config.sky_light, config.sky_effective_temp()))
        clauses.extend(self.compile_main_modifier(config))
        for index, light in enumerate(config.aux_lights):
            clauses.extend(self.compile_aux_light(light, index))

        expert_result = expert_result or {}
        expert_positive = expert_result.get("positive_clauses", [])
        clauses.extend(
            PromptClause(str(text), 1.16, "gemini_expert")
            for text in expert_positive
            if str(text).strip()
        )
        rendered_clauses = [clause.render(use_weights) for clause in clauses]
        positive = ", ".join(text for text in rendered_clauses if text)

        negative_parts = [
            "changed identity",
            "changed pose",
            "changed composition",
            "changed background",
            "background replacement",
            "new architecture",
            "new props",
            "new visible light source",
            "visible lighting equipment",
            "invented window",
            "random shadow changes",
            "inconsistent lighting direction",
            "multiple conflicting key shadows",
            "impossible lighting geometry",
            "flat ambient lighting",
            "overbaked contrast",
            "global restyle",
            "camera or lens change",
        ]
        if config.main_modifier.enabled and max(config.world_light.softbox, config.main_modifier.softness) > 0.35:
            negative_parts.append("razor-sharp projected pattern from a broad diffused light source")
        if config.main_modifier.enabled:
            negative_parts.append(_GOBO_NEGATIVE[config.main_modifier.modifier_type])
        negative_parts.extend(
            str(text).strip()
            for text in expert_result.get("negative_clauses", [])
            if str(text).strip()
        )
        negative = ", ".join(dict.fromkeys(negative_parts))
        metadata = {
            "schema": "qwen_lighting_expert_v3",
            "schema_version": "3.0.0",
            "lighting_intent": intent,
            "config": config.to_dict(),
            "expert": expert_result,
            "compiler": {
                "weights_enabled": use_weights,
                "gemini_enriched": bool(expert_result.get("analyzed")),
                "clause_count": len(clauses),
            },
        }
        return positive, negative, dump_state(metadata)
