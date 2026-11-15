"""In-memory sliding-window rate limiter.

Good enough for a single backend instance. For multiple instances, replace
``SlidingWindowLimiter`` with a Redis-backed implementation (same interface).
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional, Tuple


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float, now: Optional[float] = None) -> Tuple[bool, int]:
        """Record a hit. Returns (allowed, retry_after_seconds)."""
        if limit <= 0:
            return True, 0
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits.setdefault(key, deque())
            cutoff = now - window_seconds
            while q and q[0] <= cutoff:
                q.popleft()
            if len(q) >= limit:
                retry = max(1, math.ceil(q[0] + window_seconds - now))
                return False, retry
            q.append(now)
            if len(self._hits) > 50_000:
                self._evict(cutoff)
            return True, 0

    def _evict(self, cutoff: float) -> None:
        for key in [k for k, q in self._hits.items() if not q or q[-1] <= cutoff]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
