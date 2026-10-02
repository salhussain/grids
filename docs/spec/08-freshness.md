# 8. Data freshness

Every dataset (and every entity type fed by jobs) has `last_materialised_at`, `last_successful_run_id`, `data_version` and a **freshness policy** `{expected_interval, warn_after, stale_after}`. Freshness status is computed (`fresh | warning | stale | unknown`) and exposed on every query result. Visualisations render _"Last updated · Fresh · Expected every 15 min"_. A sensor raises alerts when a dataset goes stale.
