import asyncio
import json
import os
from datetime import date, datetime

from backend.models import Event
from backend.storage.base import EventRepository


class JSONEventRepository(EventRepository):
    def __init__(self, path: str):
        self._path = path
        self._data: dict[str, dict] = {}
        self._lock = asyncio.Lock()
        self._load()

    def _load(self):
        if os.path.exists(self._path):
            with open(self._path, "r") as f:
                raw = json.load(f)
            self._data = {e["id"]: e for e in raw}
        else:
            self._data = {}

    async def _save(self):
        os.makedirs(os.path.dirname(self._path), exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(list(self._data.values()), f, indent=2, default=str)

    async def upsert(self, event: Event) -> Event:
        async with self._lock:
            existing = self._data.get(event.id)
            if existing:
                event.created_at = datetime.fromisoformat(existing["created_at"]) if isinstance(existing["created_at"], str) else existing["created_at"]
            event.updated_at = datetime.utcnow()
            self._data[event.id] = event.model_dump(mode="json")
            await self._save()
        return event

    async def bulk_upsert(self, events: list[Event]) -> int:
        async with self._lock:
            count = 0
            for event in events:
                existing = self._data.get(event.id)
                if existing:
                    event.created_at = datetime.fromisoformat(existing["created_at"]) if isinstance(existing["created_at"], str) else existing["created_at"]
                event.updated_at = datetime.utcnow()
                self._data[event.id] = event.model_dump(mode="json")
                count += 1
            await self._save()
        return count

    async def get(self, event_id: str) -> Event | None:
        raw = self._data.get(event_id)
        if raw:
            return Event(**raw)
        return None

    async def list(
        self,
        month: str | None = None,
        category: str | None = None,
        q: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Event]:
        if month is None:
            month = date.today().strftime("%Y-%m")

        results = []
        for raw in self._data.values():
            event_date = raw["start_date"]
            if isinstance(event_date, date):
                event_month = event_date.strftime("%Y-%m")
            else:
                event_month = event_date[:7]

            if event_month != month:
                continue

            if category and category.lower() not in [c.lower() for c in raw.get("categories", [])]:
                continue

            if q:
                q_lower = q.lower()
                searchable = f"{raw.get('title', '')} {raw.get('description', '') or ''} {raw.get('location', '') or ''}".lower()
                if q_lower not in searchable:
                    continue

            results.append(raw)

        results.sort(key=lambda e: (e["start_date"], e.get("start_time") or ""))
        return [Event(**r) for r in results[offset : offset + limit]]

    async def delete(self, event_id: str) -> bool:
        async with self._lock:
            if event_id in self._data:
                del self._data[event_id]
                await self._save()
                return True
        return False

    async def categories(self) -> list[str]:
        cats = set()
        for raw in self._data.values():
            for c in raw.get("categories", []):
                cats.add(c)
        return sorted(cats)
