from __future__ import annotations

from collections import OrderedDict
from threading import RLock
from time import monotonic
from typing import Generic, Hashable, TypeVar

K = TypeVar("K", bound=Hashable)
V = TypeVar("V")


class TTLCache(Generic[K, V]):
    """Small thread-safe LRU cache with time-based expiry.

    Reads and writes are O(1). Expired entries are evicted lazily, while the
    least recently used live entry is removed when the cache reaches capacity.
    """

    def __init__(self, max_size: int, ttl_seconds: float) -> None:
        if max_size < 1 or ttl_seconds <= 0:
            raise ValueError("Cache size and TTL must be positive.")
        self._max_size = max_size
        self._ttl_seconds = ttl_seconds
        self._items: OrderedDict[K, tuple[float, V]] = OrderedDict()
        self._lock = RLock()

    def get(self, key: K) -> V | None:
        now = monotonic()
        with self._lock:
            cached = self._items.get(key)
            if cached is None:
                return None
            expires_at, value = cached
            if expires_at <= now:
                del self._items[key]
                return None
            self._items.move_to_end(key)
            return value

    def set(self, key: K, value: V) -> None:
        with self._lock:
            self._items[key] = (monotonic() + self._ttl_seconds, value)
            self._items.move_to_end(key)
            while len(self._items) > self._max_size:
                self._items.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
