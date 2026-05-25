"""Serialization helpers for lighting expert metadata."""

from __future__ import annotations

import json
from typing import Any


def dump_state(state: dict[str, Any]) -> str:
    return json.dumps(state, ensure_ascii=False, sort_keys=True)
