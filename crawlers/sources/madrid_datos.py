"""Crawler for datos.madrid.es cultural events (next 100 days)."""

import re
from datetime import datetime

import requests

from crawlers.base import BaseCrawler

JSON_URL = "https://datos.madrid.es/dataset/206974-0-agenda-eventos-culturales-100/resource/206974-0-agenda-eventos-culturales-100-json/download/206974-0-agenda-eventos-culturales-100-json.json"

# Map @type URIs to readable categories
TYPE_MAP = {
    "Exposiciones": "exposiciones",
    "ProgramacionDestacadaAgendaCultura": "destacado",
    "TeatroPerformance": "teatro",
    "Musica": "musica",
    "DanzaBaile": "danza",
    "CineCortometrajes": "cine",
    "ConferenciasColoquios": "conferencias",
    "Recitales": "recitales",
    "ActividadesBibliotecas": "bibliotecas",
    "CampamentosUrbanos": "campamentos",
    "CuentacuentosTiteresMarionetas": "infantil",
    "TalleresManualidades": "talleres",
    "ItinerariosVisitasGuiadas": "visitas guiadas",
    "CircoMagia": "circo",
    "FiestasNavidad": "fiestas",
    "FiestasCarnaval": "fiestas",
    "FiestasSanIsidro": "fiestas",
    "Otros": "otros",
}


class MadridDatosCrawler(BaseCrawler):
    name = "madrid_datos"

    def crawl(self) -> list[dict]:
        resp = requests.get(JSON_URL, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("@graph", [])
        events = []

        for item in items:
            ev = self._parse(item)
            if ev:
                events.append(ev)

        return events

    def _parse(self, item: dict) -> dict | None:
        title = (item.get("title") or "").strip()
        if not title:
            return None

        dtstart = item.get("dtstart", "")
        if not dtstart:
            return None

        start_date = dtstart[:10]
        end_date = None
        dtend = item.get("dtend", "")
        if dtend:
            end_date = dtend[:10]

        start_time = None
        end_time = None
        time_str = (item.get("time") or "").strip()
        if time_str:
            times = re.findall(r"(\d{1,2}[:.]\d{2})", time_str)
            if times:
                start_time = times[0].replace(".", ":") + ":00"
                if len(times) > 1:
                    end_time = times[1].replace(".", ":") + ":00"

        location = (item.get("event-location") or "").strip() or None

        address = item.get("address", {})
        area = address.get("area", {})
        street = (area.get("street-address") or "").strip()
        if street and location:
            location = f"{location} ({street})"

        url = (item.get("link") or "").strip() or None

        description = (item.get("description") or "").strip() or None
        if description:
            description = re.sub(r"<[^>]+>", "", description).strip()
            if len(description) > 300:
                description = description[:297] + "..."

        categories = []
        type_uri = item.get("@type", "")
        for key, cat in TYPE_MAP.items():
            if key in type_uri:
                categories.append(cat)
                break

        is_free = item.get("free")
        if is_free == 1 or is_free == "1":
            categories.append("gratis")

        return {
            "title": title,
            "description": description,
            "start_date": start_date,
            "end_date": end_date,
            "start_time": start_time,
            "end_time": end_time,
            "location": location,
            "url": url,
            "source": self.name,
            "categories": categories,
        }
