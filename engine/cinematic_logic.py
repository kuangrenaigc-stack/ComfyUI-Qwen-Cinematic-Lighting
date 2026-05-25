"""Utility descriptions shared by the lighting-only expert."""

from __future__ import annotations


def clamp(value: float, fallback: float, minimum: float, maximum: float) -> float:
    """Clamp untrusted numeric UI input, using a clamped fallback for invalid values."""
    minimum = float(minimum)
    maximum = float(maximum)
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = float(fallback)
    if number != number:  # NaN guard
        number = float(fallback)
    return max(minimum, min(maximum, number))


def normalize_angle(value: float) -> int:
    return int(round(value)) % 360


def describe_azimuth(angle: float) -> str:
    value = normalize_angle(angle)
    if value < 22.5 or value >= 337.5:
        return "frontal key light aimed toward the subject"
    if value < 67.5:
        return "front-right three-quarter key light aimed across the subject"
    if value < 112.5:
        return "right side light at a near 90-degree projection angle"
    if value < 157.5:
        return "back-right rim light grazing the subject edge"
    if value < 202.5:
        return "rear rim light aimed toward the visible subject edge"
    if value < 247.5:
        return "back-left rim light grazing the subject edge"
    if value < 292.5:
        return "left side light at a near 90-degree projection angle"
    return "front-left three-quarter key light aimed across the subject"


def describe_elevation(angle: float) -> str:
    if angle < -10:
        return "low-angle uplight below eye level"
    if angle < 18:
        return "eye-level light with horizontal shadow projection"
    if angle < 45:
        return "elevated key light above eye level with downward shadow projection"
    return "high overhead light with steep downward projection"


def describe_distance(distance: float) -> str:
    if distance < 1.25:
        return "close light placement with rapid falloff"
    if distance < 2.75:
        return "medium light placement with controlled falloff"
    if distance < 5.0:
        return "far light placement with even falloff"
    return "distant motivated source with broad even falloff"


def describe_temperature(kelvin: int) -> str:
    if kelvin < 3200:
        return "warm tungsten color temperature"
    if kelvin < 4300:
        return "warm neutral color temperature"
    if kelvin < 5600:
        return "balanced daylight color temperature"
    if kelvin < 7000:
        return "cool daylight color temperature"
    return "cold blue color temperature"