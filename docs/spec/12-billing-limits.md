# 12. Billing & limits

- **Plans** live in the control plane. Each plan maps to **entitlements**: limits (`projects`, `users`, `forms`, `submissions/month`, `storage_gb`, `api_calls/month`, `rows_ingested/month`, `run_minutes/month`) and feature flags (`sso`, `dhis2`, `custom_domain`, `dedicated_db`, `custom_code`).
- **Enforcement:**
  - An entitlement cache sits in API middleware. **Hard limits** apply at create time (projects, users, forms).
  - **Metered limits** use usage counters that are incremented asynchronously and rolled up hourly. They have soft warnings at 80% and a configurable hard stop or overage.
  - Workers check quotas before runs.
- **Payments:** Stripe (subscriptions and metered usage) is post-MVP. The MVP has plans and enforcement but manual assignment.
