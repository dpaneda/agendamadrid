"""Discover crawler classes in crawlers/sources/."""

import importlib
import os
import sys
import pkgutil


def discover_crawlers():
    """Import all modules in crawlers/sources/ and return BaseCrawler subclass instances."""
    from crawlers.base import BaseCrawler

    sources_dir = os.path.join(os.path.dirname(__file__), "sources")
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    crawlers = []
    for importer, name, _ in pkgutil.iter_modules([sources_dir]):
        mod = importlib.import_module(f"crawlers.sources.{name}")
        for attr in dir(mod):
            obj = getattr(mod, attr)
            if isinstance(obj, type) and issubclass(obj, BaseCrawler) and obj is not BaseCrawler and not obj.__name__.startswith("_"):
                crawlers.append(obj())
    return crawlers
