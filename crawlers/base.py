from abc import ABC, abstractmethod


class BaseCrawler(ABC):
    name: str = "base"

    @abstractmethod
    def crawl(self) -> list[dict]:
        """Return a list of event dicts matching EventCreate schema."""
        ...
