"""Crawlers for datos.madrid.es open data feeds.

All datasets share the same JSON-LD structure, so we use a common parser.
"""

import re

import requests

from crawlers.base import BaseCrawler
from crawlers.categories import normalize

# Map @type URIs to our canonical categories
TYPE_MAP = {
    # Cultural
    "Exposiciones": "exposiciones",
    "ProgramacionDestacadaAgendaCultura": "destacado",
    "TeatroPerformance": "teatro",
    "Musica": "musica",
    "DanzaBaile": "danza",
    "CineCortometrajes": "cine",
    "CineActividadesAudiovisuales": "cine",
    "CineFiccion": "cine",
    "ConferenciasColoquios": "conferencias",
    "Recitales": "musica",
    "CircoMagia": "circo",
    # Bibliotecas / literatura
    "ActividadesBibliotecas": "literatura",
    "ClubesLectura": "literatura",
    # Infantil / joven
    "CampamentosUrbanos": "infantil",
    "CuentacuentosTiteresMarionetas": "infantil",
    "ActividadesEscolares": "infantil",
    "JOBO": "infantil",
    "Campamentos": "infantil",
    # Talleres / cursos
    "TalleresManualidades": "talleres",
    "CursosTalleres": "talleres",
    # Visitas / excursiones
    "ItinerariosVisitasGuiadas": "visitas guiadas",
    "ExcursionesItinerariosVisitas": "visitas guiadas",
    "ItinerariosOtrasActividadesAmbientales": "visitas guiadas",
    # Deportes
    "ActividadesDeportivas": "deportes",
    "CarrerasMaratones": "deportes",
    "Ciclismo": "deportes",
    "Natacion": "deportes",
    # Fiestas / festivales
    "FiestasNavidad": "fiestas",
    "FiestasCarnaval": "fiestas",
    "FiestasSanIsidro": "fiestas",
    "FiestasSemanaSanta": "fiestas",
    "Fiestas": "fiestas",
    "Festivales": "fiestas",
    # Gastronomia
    "Gastronomia": "gastronomia",
    # Otros
    "1ciudad21distritos": "otros",
    "ActividadesCalleArteUrbano": "otros",
    "ComemoracionesHomenajes": "otros",
    "ConcursosCertamenes": "otros",
    "EnLinea": "otros",
    "Otros": "otros",
}


def parse_madrid_event(item: dict, source: str) -> dict | None:
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

    location_name = (item.get("event-location") or "").strip() or None

    address_data = item.get("address", {})
    area = address_data.get("area", {})
    street = (area.get("street-address") or "").strip()
    district_id = address_data.get("district", {}).get("@id", "")
    district = district_id.split("/")[-1] if "/" in district_id else None

    address = street or None

    loc = item.get("location", {})
    latitude = loc.get("latitude") if loc else None
    longitude = loc.get("longitude") if loc else None
    if latitude == 0 and longitude == 0:
        latitude = None
        longitude = None

    url = (item.get("link") or "").strip() or None

    description = (item.get("description") or "").strip() or None
    if description:
        description = re.sub(r"<[^>]+>", "", description).strip()
        if len(description) > 300:
            description = description[:297] + "..."

    categories = []
    type_uri = item.get("@type", "") or ""
    matched = False
    for key, cat in TYPE_MAP.items():
        if key in type_uri:
            categories.append(cat)
            matched = True
            break
    if not matched:
        categories.append("otros")

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
        "location_name": location_name,
        "address": address,
        "district": district,
        "latitude": latitude,
        "longitude": longitude,
        "url": url,
        "source": source,
        "categories": normalize(categories),
    }


class _MadridDatosBase(BaseCrawler):
    """Base for datos.madrid.es JSON-LD feeds."""
    json_url: str = ""

    def crawl(self) -> list[dict]:
        resp = requests.get(self.json_url, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        events = []
        for item in data.get("@graph", []):
            ev = parse_madrid_event(item, self.name)
            if ev:
                events.append(ev)
        return events


class MadridDatosAgendaGeneralCrawler(_MadridDatosBase):
    name = "madrid_agenda"
    json_url = "https://datos.madrid.es/egob/catalogo/300107-0-agenda-actividades-eventos.json"
