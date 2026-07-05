# Segmentación de eventos por formato

**Fecha:** 2026-07-05
**Estado:** aprobado (incremento A)

## Problema

El listado mezcla tres tipos de evento que tienen poco que ver entre sí:

- **Puntuales**: 1 día o pocos días, con hora concreta (conciertos, funciones). O vas ese día o te lo pierdes.
- **Exposiciones / larga duración**: expos y obras "en cartel" durante semanas o meses. Se pueden visitar muchos días.
- **Festivales / ciclos** (multieventos): contenedores que engloban varios sub-eventos distintos.

Ya existe el dato `is_multi_event` (generado por el enriquecimiento LLM en `llm_enrich.py` y propagado en `consolidate.py`), pero **el frontend no lo usa** — ni se muestra ni permite filtrar. El usuario "recordaba tener tags" pero no los ve porque solo están en los datos.

Distribución actual (773 eventos): 15% multieventos; por duración ~32% 1 día, ~15% 2-7 días, ~29% 8-29 días, ~22% larga duración.

## Objetivo

**Segmentar/filtrar**, conservando todos los eventos. Dar al usuario una forma de ver por separado los tres formatos.

## Alcance por fases

- **Fase A (este spec)**: campo `formato` calculado en backend + 3 chips de filtro excluyentes en la vista de lista.
- **Fase B (futuro)**: vista dedicada "Exposiciones" como catálogo independiente de fecha (las expos encajan mal en una lista por día).
- **Fase C (futuro)**: tratamiento de festivales como contenedores (posible desgranado en sub-eventos).

Destino deseado: enfoque híbrido (chips + vista de expos). Se entrega incrementalmente empezando por A.

## Diseño — Fase A

### Backend (`consolidate.py`)

Nueva función pura y testeable:

```
classify_format(event, duration_days) -> "festival" | "exposicion" | "puntual"
```

Prioridad (excluyente):

1. **festival** — si `event.is_multi_event` es true, **o** el título casa (con límites de palabra, case-insensitive) con `festival | ciclo | temporada | semana de`. El heurístico de título compensa la cobertura parcial del LLM.
2. **exposicion** — si no es festival y `duration_days >= EXPO_MIN_DAYS` (constante = **21**).
3. **puntual** — el resto.

`duration_days` se calcula desde las fechas reales del evento (`start_date` → `end_date` de `raw_events`), no desde la ventana recortada del calendario:

```
duration_days = (end_date - start_date).days + 1   # si ambas parseables
              = 1                                    # si falta end_date o no parsea
```

Se añade `formato` a cada evento en `events.json`. Determinista; no depende de que el LLM haya enriquecido el evento.

`EXPO_MIN_DAYS = 21` es el único parámetro afinable (constante nombrada).

### Frontend (`app.js`)

- Nuevo estado `activeFormato` (string; `""` = todos). Persistido en `sessionStorage` como los demás filtros de sesión.
- En `_applyListFilters`, tras los filtros existentes:
  `if (activeFormato) events = events.filter(ev => ev.formato === activeFormato);`
- 3 chips excluyentes en la zona de filtros de la vista de lista, siguiendo el patrón de los chips de categoría (`filter-chip`): **Puntual · Exposiciones · Festivales**. Click en el chip activo lo desactiva (vuelve a "todos").
- El formato activo aparece como tag eliminable en la barra de filtros activos (junto a categoría/localización).
- No toca el eje de categorías de contenido (teatro/música/…), que es independiente.

### Fuera de alcance (Fase A)

- Vistas nuevas (Fase B/C).
- Reclasificar o desgranar festivales.
- Cambiar el enriquecimiento LLM.

## Testing

- **Backend**: tests unitarios de `classify_format` — festival por flag, festival por keyword de título, exposición por umbral (límites 20/21 días), puntual, y precedencia (multievento largo → festival, no exposición). Igual que los tests puros existentes en `tests/test_build_data.py`.
- **Frontend**: verificación en navegador — los 3 chips filtran correctamente y son excluyentes; combinación con otros filtros; el tag activo se puede quitar.

## Riesgos

- Cobertura parcial de `is_multi_event`: algunos festivales sin enriquecer se clasificarán como puntual/exposición. Mitigado en parte por el heurístico de título; mejorable en el futuro.
- El umbral de 21 días es un juicio; fácil de ajustar (constante única).
