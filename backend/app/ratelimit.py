"""Per-key token bucket, in memory. Fine because the server runs a single process."""
import math
import threading
import time


class RateLimiter:
    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self._buckets: dict[int, tuple[float, float]] = {}  # key_id -> (tokens, last_refill)

    def check(self, key_id: int, per_minute: int) -> float | None:
        """Take one token. Returns None if allowed, otherwise seconds until a token is available."""
        capacity = float(per_minute)
        rate = per_minute / 60.0
        now = self._clock()
        with self._lock:
            tokens, last = self._buckets.get(key_id, (capacity, now))
            tokens = min(capacity, tokens + (now - last) * rate)
            if tokens >= 1.0:
                self._buckets[key_id] = (tokens - 1.0, now)
                return None
            self._buckets[key_id] = (tokens, now)
            return (1.0 - tokens) / rate

    def forget(self, key_id: int) -> None:
        with self._lock:
            self._buckets.pop(key_id, None)


def retry_after_header(seconds: float) -> dict:
    return {"Retry-After": str(max(1, math.ceil(seconds)))}
