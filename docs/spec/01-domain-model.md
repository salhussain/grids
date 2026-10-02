# 1. Core concepts (domain glossary)

| Concept                         | Definition                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform**                    | Us. Owns the control plane, plans, tenant provisioning and the platform console.                                                                          |
| **Tenant = Organisation**       | The unit of billing, isolation, branding and identity configuration. Every tenant row carries `tenant_id`.                                                |
| **Org Unit**                    | A node in the org's _people structure_ (region → department → team → unit, with arbitrary depth). Used to group users and delegate administration.        |
| **Project**                     | A self-contained application inside a tenant: entity types, hierarchy, forms, datasets, dashboards, jobs, members and visibility (public or private).     |
| **Entity Type**                 | A schema for a kind of thing (Country, Facility, Patient, Aircraft, Asset), defined per project, with typed **Attribute Definitions**.                    |
| **Entity**                      | An instance of a type. It has current attribute state, optional geometry, and one or more positions in hierarchies.                                       |
| **Hierarchy**                   | A named tree over entities. A project can have several (for example geographic and administrative).                                                       |
| **Form**                        | A versioned, declarative survey definition bound to a _subject entity type_.                                                                              |
| **Submission**                  | An immutable response to a specific form version, about one subject entity.                                                                               |
| **Observation**                 | An atomic fact: `(entity, data_element, period/time, value, source)`. This is the canonical analytic grain, compatible with DHIS2.                        |
| **Data Element**                | A tenant-defined metric or variable (for example `altitude_ft` or `patient_weight_kg`), with a type, unit and aggregation default.                        |
| **Dataset**                     | A queryable, versioned table (a materialised "asset" in Dagster terms) with a schema and freshness policy, produced by jobs or derived from observations. |
| **Connection / Connector**      | Stored credentials plus a typed adapter to an external source or sink (HTTP API, Postgres, S3, DHIS2, …).                                                 |
| **Job**                         | A DAG of typed steps (extract → parse → map → transform → load → notify).                                                                                 |
| **Schedule / Sensor / Trigger** | Things that start runs: cron, a polled condition, or an internal or external event.                                                                       |
| **Run**                         | One execution of a job, with per-step state, logs, retries and the datasets it produced.                                                                  |
| **Visualisation**               | A declarative spec: a **query** (semantic) plus a **presentation** (chart, map layer, table, KPI) plus **parameters**.                                    |
| **Dashboard**                   | A layout of visualisations with shared parameters, bound to a project and optionally to an entity level.                                                  |

**Key relationships.** A Tenant has many Projects, Org Units, Members, Connections and a Theme. A Project has many Entity Types, Hierarchies, Forms, Data Elements, Datasets, Jobs, Dashboards and Project Members. Entities belong to a Project. Users are **global identities** (control plane) holding **memberships** in one or more tenants.
