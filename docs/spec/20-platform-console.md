# 20. Platform console & commercial operations

The platform console (`apps/console`) is where Grids staff run the business: onboarding, pricing, billing, support and operations.

## Organisation lifecycle

```
create ──► pending_payment ──subscribe──► (paid plan) invoice issued ──record payment──► provisioning ──► active
                              └─(trial / free plan)────────────────────────────────────► provisioning ──► active
active ◄──► suspended          any ──► cancelled (subscription cancelled, open invoices voided)
```

1. **Create.** Business profile: display and legal name, industry, size, website, registration and tax numbers, contact details, registered address, time zone, currency and language. Primary, billing and technical contacts. Internal notes. The slug is generated from the legal name (or display name) when left blank, de-duplicated with `-2`, `-3` and so on.
2. **Subscribe.** Plan plus billing cycle. Yearly cycles apply the plan's yearly discount. An optional negotiated discount combines with it multiplicatively (15% then 10% is 23.5% off). Prices are snapshotted on the subscription, so later plan price changes never alter existing customers.
3. **Pay.** Paid plans issue an invoice (`INV-YYYY-NNNNN`, 14-day terms) to the billing contact, or the primary contact if there's no billing contact. Recording the payment activates the subscription and **provisions** the tenant: it initialises the data cell, creates the IdP organisation and applies the 2FA policy. Trials and free plans provision immediately.
4. **Invite administrators.** Only active organisations accept invitations. An invitation records first and last name, job title, department, phone and an optional message. Seats (members plus pending invitations) count against the plan's `users` limit.

Provisioning is idempotent and resumable. If the IdP is unavailable the tenant stays `provisioning`, and "Resume provisioning" finishes it.

## Payments

Payments are **recorded manually** for now (bank transfer, card terminal, cash, cheque), with a reference and date. A payment-provider adapter (Stripe) plugs in at `BillingService.recordPayment`. Renewal invoices are issued from the subscription and will be automated by the orchestration engine (M4). Paying a renewal advances the billing period.

## People & security (shared with organisation admins)

Organisation-scoped endpoints (`/tenants/:id/*`) authorise **either** platform staff **or** that organisation's active administrators. The M2 workspace will reuse them unchanged.

- **Members:** captured person details, role, per-organisation status (`active`/`suspended`) and 2FA enrolment (read from the IdP per user). A suspended membership loses all access to that organisation. The last active administrator can't be demoted or suspended.
- **2FA policy:** `mfa_required` per organisation, enforced by the IdP (a Zitadel org login policy with `forceMfa`).
- **Invitations:** emailed, with a 7-day expiry. Only a hash of the token is stored. Resending rotates the token, so the old link stops working. Invitations can be revoked.

## Custom domains (URL translation)

Every tenant is reachable at `{slug}.{BASE_DOMAIN}`. On plans with `custom_domain`:

1. The customer creates a `CNAME` from `data.example.org` to `edge.{BASE_DOMAIN}`.
2. The customer publishes `TXT _grids-challenge.data.example.org = grids-verify=<token>`. **Verify** checks it over DNS.
3. Once verified, the domain can be made **primary**. The edge then **301-redirects** the platform subdomain (and any non-primary domain) to it.

Edge contract:

- `GET /edge/resolve?host=` returns `{tenantId, tenantSlug, canonicalHost, redirect}`, which the edge proxy uses to route the Host header and redirect.
- `GET /edge/tls-allowed?domain=` returns 200 or 404. It's an on-demand TLS gate, compatible with Caddy's `ask`, so certificates are only issued for verified hosts.

In dev, `*.localhost` and `*.test` hostnames verify without DNS (`DOMAIN_DEV_AUTOVERIFY`).

## Support desk

Organisation members raise tickets for their own organisation. Staff can also open one on an organisation's behalf. Staff triage tickets (status, priority, assignee) and can add **internal notes** that customers never see. A staff reply sets the ticket to `pending` (awaiting the customer). A customer reply reopens it (`open`). New tickets and replies send email notifications.

## Logs

- **System log:** the append-only `platform_audit_log` covers every mutation, filterable by area, organisation and free text, with cursor pagination.
- **Email log:** every transactional email attempt (template, recipient, body, delivery status and error). Delivery failures never fail the business operation that sent the email.

Dev mail goes to Mailpit (http://localhost:8025).
