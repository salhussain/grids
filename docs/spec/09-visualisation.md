# 9. Semantic layer, visualisations & dashboards

- **Query spec** (JSON):
  `{ source: dataset | observations | entities, measures: [{field, agg}], dimensions: [field | time_bucket | hierarchy_level], filters, date_range, params, limit, sort }`.
  The server compiles it to SQL (Kysely) against Postgres, with **permission predicates and tenant RLS always injected**. Users never send raw SQL to the read path.
- **Hierarchy roll-up:** "aggregate to level = Region" uses ltree paths, which is how map overlays work at each level.
- **Caching:** the result cache is keyed by `(query hash, data_version of the inputs, permission-context hash)`, so it invalidates exactly when data changes.
- **Presentation spec:** `type` (line, bar, area, pie, scatter, heatmap, KPI tile, table, pivot, map layer: points, choropleth, heat or tracks), encodings, formatting, thresholds and drilldown target.
- **Parameters** (date, entity, enum) are bound to query placeholders and exposed in the dashboard header.
- **Libraries:**
  - **Apache ECharts:** canvas/WebGL rendering, handles very large series, the broadest range of chart types, and themeable from tenant tokens.
  - **MapLibre GL JS** with **OpenStreetMap vector tiles** (OpenFreeMap or self-hosted Protomaps PMTiles, so there are no per-tile fees).
  - **deck.gl** for high-volume dynamic layers such as thousands of aircraft.
  - **TanStack Table** for tables.
- **Dashboards:** a grid layout (`react-grid-layout`) of visualisation instances with shared parameters. They are responsive, with stacked layouts on mobile.
- **Live updates:** server-sent events (SSE) stream `dataset.materialised` events, and clients refetch or patch.
