# ADR 0006: Immutable form versions and append-only submissions

- Status: Accepted (2026-10-02)

## Decision

Forms are edited as drafts and published as immutable versions. Submissions reference a `form_version_id`, use client-generated UUIDv7 IDs, and are never updated in place (corrections are new submissions or amendments). Side effects (attribute changes, observations) are derived from submissions.

## Consequences

Offline sync is simple for submissions (no conflicts). Reprocessing is possible by replaying submissions.
