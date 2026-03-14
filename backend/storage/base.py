from abc import ABC, abstractmethod

from backend.models import Event


class EventRepository(ABC):
    @abstractmethod
    async def upsert(self, event: Event) -> Event: ...

    @abstractmethod
    async def bulk_upsert(self, events: list[Event]) -> int: ...

    @abstractmethod
    async def get(self, event_id: str) -> Event | None: ...

    @abstractmethod
    async def list(
        self,
        month: str | None = None,
        category: str | None = None,
        q: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Event]: ...

    @abstractmethod
    async def delete(self, event_id: str) -> bool: ...

    @abstractmethod
    async def categories(self) -> list[str]: ...
