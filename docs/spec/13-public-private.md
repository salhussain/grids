# 13. Public vs private projects

`project.visibility = public | private`. A public project exposes only objects flagged `public` (dashboards, datasets and map layers) to the anonymous principal through a read-only API. That API has aggressive CDN and HTTP caching and per-IP rate limits, and it never allows writes or forms (unless a form is explicitly marked as accepting public submissions, later). Public data also counts toward the tenant's API quota.
