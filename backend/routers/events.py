from fastapi import APIRouter, Depends, Header, HTTPException, Query

from backend.models import Event, EventCreate
from backend.storage.base import EventRepository

router = APIRouter(prefix="/api")

_repo: EventRepository | None = None


def set_repo(repo: EventRepository):
    global _repo
    _repo = repo


def get_repo() -> EventRepository:
    assert _repo is not None
    return _repo


def require_api_key(x_api_key: str = Header(...)):
    from backend.config import API_KEY
    if x_api_key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


@router.get("/events")
async def list_events(
    month: str | None = None,
    category: str | None = None,
    q: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    repo: EventRepository = Depends(get_repo),
):
    return await repo.list(month=month, category=category, q=q, limit=limit, offset=offset)


@router.get("/events/{event_id}")
async def get_event(event_id: str, repo: EventRepository = Depends(get_repo)):
    event = await repo.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/events", dependencies=[Depends(require_api_key)])
async def create_event(data: EventCreate, repo: EventRepository = Depends(get_repo)):
    event = Event(**data.model_dump())
    return await repo.upsert(event)


@router.post("/events/bulk", dependencies=[Depends(require_api_key)])
async def bulk_create(events: list[EventCreate], repo: EventRepository = Depends(get_repo)):
    parsed = [Event(**e.model_dump()) for e in events]
    count = await repo.bulk_upsert(parsed)
    return {"upserted": count}


@router.delete("/events/{event_id}", dependencies=[Depends(require_api_key)])
async def delete_event(event_id: str, repo: EventRepository = Depends(get_repo)):
    deleted = await repo.delete(event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"deleted": True}


@router.get("/categories")
async def list_categories(repo: EventRepository = Depends(get_repo)):
    return await repo.categories()
