# 4. Entities, hierarchies & attributes

- `entity_type(id, project_id, key, name, attribute_schema_version, geometry_kind)`
- `attribute_def(entity_type_id, key, data_type [text|number|bool|date|enum|geo|ref|json], required, unique, sensitivity, source_priority)`
- `entity(id uuid v7, project_id, type_id, code, name, geometry (PostGIS), attributes jsonb /* current state */, version, updated_at)`
- `hierarchy(id, project_id, name)` and `entity_edge(hierarchy_id, parent_id, child_id)`, plus a materialised **`ltree` path** per (entity, hierarchy) for fast subtree queries and permission predicates. Allowed parent→child _type rules_ are kept per hierarchy (for example Country → Region → Facility → Patient).
- **Attribute history:** every change writes `attribute_change(entity_id, key, old, new, source {submission|job|user|sync}, source_ref, hlc_ts)`. The `attributes` jsonb column is the **projection**, rebuilt from history using source-priority rules.
- **Survey → entity:** a form declares **attribute bindings**, for example `question q_phone → Patient.contact.phone`. On submission, a binding processor writes attribute changes. The raw submission stays immutable, and the entity's current state is the merged projection. That gives the Patient view: demographics (attributes), plus Survey A and Survey B results (linked submissions), plus observations.
