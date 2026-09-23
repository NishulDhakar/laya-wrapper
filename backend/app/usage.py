"""Usage aggregation. Done in Python rather than SQL so it behaves the same on SQLite and Postgres
(neither has a portable percentile function)."""
from collections import defaultdict
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import ApiKey, CallLog


def p95(values: list[float]) -> float:
    """Nearest-rank 95th percentile."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, -(-95 * len(ordered) // 100))  # ceil(0.95 * n)
    return ordered[rank - 1]


def _stats(rows: list[CallLog]) -> dict:
    lat = [r.latency_ms for r in rows]
    errors = sum(1 for r in rows if r.status_code >= 400)
    return {
        "calls": len(rows),
        "errors": errors,
        "error_rate": round(errors / len(rows), 4) if rows else 0.0,
        "avg_latency_ms": round(sum(lat) / len(lat), 2) if lat else 0.0,
        "p95_latency_ms": round(p95(lat), 2),
    }


def usage_report(db: Session, start: date, end: date, now: datetime) -> dict:
    """Stats for calls with start <= day <= end (UTC days)."""
    since = datetime.combine(start, datetime.min.time())
    until = datetime.combine(end + timedelta(days=1), datetime.min.time())
    rows = list(db.scalars(select(CallLog).where(CallLog.created_at >= since, CallLog.created_at < until)))
    names = {k.id: k.name for k in db.scalars(select(ApiKey))}

    by_key: dict[tuple, list[CallLog]] = defaultdict(list)
    by_day: dict[date, list[CallLog]] = defaultdict(list)
    for r in rows:
        by_key[(r.key_id, r.source)].append(r)
        by_day[r.created_at.date()].append(r)

    per_key = []
    for (key_id, source), items in by_key.items():
        if source == "playground":
            label = "playground"
        elif key_id is None:
            label = "unauthenticated"
        else:
            label = names.get(key_id, f"#{key_id} (deleted)")
        per_key.append({"key_id": key_id, "source": source, "name": label, **_stats(items)})
    per_key.sort(key=lambda k: k["calls"], reverse=True)

    per_day = []
    d = start
    while d <= end:
        per_day.append({"date": d.isoformat(), **_stats(by_day.get(d, []))})
        d += timedelta(days=1)

    today = now.date()
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "totals": _stats(rows),
        "today": _stats(by_day.get(today, [])),
        "per_key": per_key,
        "per_day": per_day,
    }
