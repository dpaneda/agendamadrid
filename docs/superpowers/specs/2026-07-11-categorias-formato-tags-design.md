# Rediseño de categorías: Formato primario + tags planos

**Fecha**: 2026-07-11
**Estado**: Diseño aprobado, pendiente de plan de implementación

## Problema

El sistema actual mezcla tres ejes con fronteras arbitrarias:

- **Categorías canónicas** (`crawlers/categories.py`): 8 `CATEGORIES` + 19 `TAGS`. La división es un artefacto de la fuente (los 8 tipos de esmadrid son "principales"), no del uso real: `cine` (124 eventos) e `infantil` (116) son "subcategorías" mientras `deportes` (28) y `ferias` (33) son "principales".
- **Formato** (`consolidate.py:classify_format`): eje excluyente derivado (`puntual` / `exposicion` / `festival`), poco visible en la UI.
- **Presentación** (`app.js`): el vocabulario se reagrupa en 5 estructuras dispersas (`CATEGORY_LABELS`, `CAT_ICONS`, `MAIN_CATS`, `TAG_ORDER`, `TAG_CATS`), fáciles de desincronizar. `destacado` y `accesible` quedan huérfanos (no aparecen en ningún filtro).

Tres dolores concretos: (1) la división principal/subcategoría es arbitraria, (2) la mantenibilidad exige tocar 5 sitios para un cambio, (3) la UX de filtrado no refleja cómo la gente busca.

## Objetivo

Pasar de 3 ejes confusos a **2 ejes claros**, hacer el **Formato** el eje primario y visible, y aplanar el resto del vocabulario en un único espacio de **tags**. Sin cambiar el vocabulario canónico (los mismos 27 valores) ni el backend.

## Modelo conceptual

| Eje | Qué es | Comportamiento |
|---|---|---|
| **Formato** (primario) | `puntual` / `exposicion` / `festival` → "Puntual" / "Exposiciones" / "Eventos temáticos" | Excluyente, single-select. Tarjetas grandes siempre visibles. Sin selección = "Todos" |
| **Tags** (secundario) | Los 27 valores canónicos, planos (teatro, cine, gratis, flamenco…) | Multi-select, OR interno. Nube ordenada por volumen |

Desaparece la distinción "categoría principal vs subcategoría" de cara al usuario. El eje Formato ya existe internamente; solo cambia su prominencia.

## UX

### Tarjetas de Formato

- 3 tarjetas grandes bajo la cabecera, en vista lista y vista mapa: `🎯 Puntual`, `🖼 Exposiciones`, `🎪 Eventos temáticos`.
- Cada tarjeta muestra un **recuento contextual**: nº de eventos del día seleccionado que caen en ese formato, respetando el resto de filtros activos (tags, ubicación, fuente, búsqueda) pero **no** el propio filtro de formato.
- Single-select: tocar una tarjeta la activa; tocarla de nuevo vuelve a "Todos" (ninguna activa). El estado "Todos" es la ausencia de selección, no una cuarta tarjeta.
- El label visible de `festival` sigue siendo "Eventos temáticos" (el valor interno `festival` no cambia).

### Panel / sidebar de tags

- El filtro de **Formato sale del panel** (ahora vive en las tarjetas). El contenedor de tags queda solo con la nube plana + botón "Limpiar filtros".
- **Nube plana** ordenada por volumen descendente (los tags con más eventos primero), multi-select, OR interno entre tags, AND con el formato activo.
- `gratis` pasa a ser un tag filtrable más (hoy no lo es; solo se muestra como badge de precio).
- **Responsive**:
  - **Móvil** (`max-width: 640px`): los tags viven en el modal centrado actual, abierto con el icono ☰ de la cabecera.
  - **Desktop**: los tags viven en una **sidebar fija siempre visible** a la izquierda de la lista de eventos (se filtra sin abrir nada). El icono ☰ se oculta vía CSS por encima del breakpoint.

### Badges en la tarjeta de evento

- Se muestra como badge de color el tag de `kind: "tipo"` más relevante (primero por volumen global), más el badge de precio (`Gratis` / precio) y la distancia, como hoy.
- Los tags de `kind: "atributo"` (`gratis`, `aire libre`, `accesible`, `destacado`) no compiten por el badge de tipo.

### Mis Intereses (Ajustes)

- Sin cambios funcionales: sigue permitiendo desactivar cualquier tag para ocultarlo en toda la app (lista, mapa, calendario). Ahora opera sobre la lista plana de tags en vez de sobre "categorías principales / subcategorías".

## Arquitectura frontend (enfoque: solo frontend)

### Fuente única de verdad

Una sola tabla en `app.js` reemplaza a `CATEGORY_LABELS`, `CAT_ICONS`, `MAIN_CATS`, `TAG_ORDER` y `TAG_CATS`:

```js
const TAGS = {
  teatro:  { label: "teatro", emoji: "🎭", color: "#1D4ED8", kind: "tipo" },
  gratis:  { label: "gratis", emoji: "🆓", color: "#16A34A", kind: "atributo" },
  // … los 27 valores, cada uno definido UNA vez
};
```

- `kind: "atributo"` para `{gratis, aire libre, accesible, destacado}`; `kind: "tipo"` para el resto.
- Se conservan los alias legacy (`musica`, `fotografia`) como entradas en `TAGS` (marcadas para no aparecer en la nube de filtros pero sí resolver label/emoji), de modo que `excludedCats` antiguos en el `localStorage` del usuario sigan renderizando. Los datos de `events.json` ya vienen normalizados por el backend, así que no contendrán slugs legacy.

### Orden por volumen en runtime

- Al cargar `events.json`, se cuenta la frecuencia global de cada tag y se deriva el orden de la nube. No hay lista de orden mantenida a mano (`TAG_ORDER` desaparece).
- El "tag de tipo más relevante" para el badge de tarjeta se calcula con el mismo recuento global.

### Estado y filtrado

- `activeFormato` (ya existe) sigue siendo single-select; su UI pasa a las tarjetas.
- `activeCatFilter` + `activeTagFilter` se **unifican en un único `activeTagFilter`** (lista plana), ya que desaparece la distinción. El filtrado queda: excluir por Mis Intereses → AND con formato → OR dentro de tags.
- `excludedCats` (Mis Intereses) sigue igual, operando sobre slugs de tag.

### Backend

- **Sin cambios**. `crawlers/categories.py` (set canónico + migración) y `crawlers/consolidate.py` (`classify_format`, inferencia de padre vía `TAG_PARENT`, poda de `otros`) se mantienen intactos. La distinción `CATEGORIES`/`TAGS` en el backend es higiene de datos interna y no se expone al usuario.
- No se regeneran datos ni se tocan los crawlers.

## Qué se elimina / cambia en `app.js`

- **Eliminar**: `CATEGORY_LABELS`, `CAT_ICONS`, `MAIN_CATS`, `TAG_ORDER`, `TAG_CATS`, `CAT_PRIORITY` (el orden pasa a ser por volumen).
- **Añadir**: tabla `TAGS` única; función de recuento/orden por volumen; render de tarjetas de formato; sidebar de tags en desktop.
- **Modificar**: `eventBadges` (usa `TAGS[c].kind` y volumen), `_applyCatFilter` (un solo eje de tags), `renderFilterPanelContent` (sin sección Formato, nube plana), render de Mis Intereses (lista plana), CSS responsive (sidebar desktop / modal móvil).
- Actualizar `CLAUDE.md` (hoy dice "18 categorías + 4 tags", incorrecto).

## Testing

- Verificar en navegador (skill `verify`): tarjetas de formato filtran y muestran recuentos correctos por día; nube de tags filtra en OR; sidebar en desktop y modal en móvil; Mis Intereses oculta tags en lista/mapa/calendario; badges de tarjeta muestran el tag de tipo correcto.
- Comprobar que los tests existentes (`pytest tests/`) siguen pasando (no debería haber impacto: backend intacto).
- Regresión visual manual de los 3 temas (Clásico / Madrid / Noche).

## Fuera de alcance

- Fusionar o reducir el vocabulario (p. ej. unir `conciertos`/`musicales`/`ópera`). Descartado explícitamente.
- Cambios en el backend / pipeline de datos.
- Cambiar la lógica de `classify_format`.
