"""Provider adapter interface.

A provider turns (person image, garment image, category) into a result image.
Adapters must raise :class:`ProviderError` on any failure and must never
return a placeholder image: the API only reports success when real image
bytes came back from the provider.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional

from ..images import ImagePayload

CATEGORIES = ("upper_body", "lower_body", "dresses")


@dataclass
class TryOnRequest:
    person: ImagePayload
    garment: ImagePayload
    category: str
    garment_description: str = ""


@dataclass
class TryOnOutput:
    data: bytes
    mime: str


# report(status, progress_percent_or_None, human_message)
ProgressCallback = Callable[[str, Optional[int], str], Awaitable[None]]


async def _noop_report(status: str, progress: Optional[int], message: str) -> None:
    return None


class TryOnProvider(abc.ABC):
    #: Machine name, e.g. "replicate".
    name: str = "base"
    #: Human readable label shown in the consent text.
    display_name: str = "AI provider"
    #: Model / licence note shown in docs and health output.
    model_note: str = ""

    @property
    @abc.abstractmethod
    def configured(self) -> bool:
        """True when credentials and endpoint are present."""

    @abc.abstractmethod
    async def run(self, request: TryOnRequest, report: ProgressCallback = _noop_report) -> TryOnOutput:
        """Run a try-on. Raise ProviderError on failure."""
