import hashlib
from datetime import date, time, datetime
from pydantic import BaseModel, Field, model_validator


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    start_date: date
    end_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None
    location: str | None = None
    url: str | None = None
    image_url: str | None = None
    source: str
    categories: list[str] = Field(default_factory=list)


class Event(EventCreate):
    id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    @model_validator(mode="after")
    def generate_id(self):
        if not self.id:
            title_norm = self.title.strip().lower()
            raw = f"{self.source}:{title_norm}:{self.start_date.isoformat()}"
            self.id = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return self
