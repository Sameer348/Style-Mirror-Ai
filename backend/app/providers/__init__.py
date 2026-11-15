from __future__ import annotations

from ..config import Settings
from .base import CATEGORIES, TryOnOutput, TryOnProvider, TryOnRequest
from .generic_http import GenericHttpProvider
from .replicate import ReplicateProvider


class UnconfiguredProvider(GenericHttpProvider):
    """Used when TRYON_PROVIDER=none. Always reports not configured."""

    name = "none"
    display_name = "no provider"
    model_note = "No try-on provider configured."

    @property
    def configured(self) -> bool:
        return False


def build_provider(settings: Settings) -> TryOnProvider:
    if settings.tryon_provider == "replicate":
        return ReplicateProvider(settings)
    if settings.tryon_provider == "generic":
        return GenericHttpProvider(settings)
    return UnconfiguredProvider(settings)


__all__ = [
    "CATEGORIES",
    "TryOnOutput",
    "TryOnProvider",
    "TryOnRequest",
    "build_provider",
    "GenericHttpProvider",
    "ReplicateProvider",
    "UnconfiguredProvider",
]
