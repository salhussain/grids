# 11. Mobile & offline-first

- **Now:** every UI is responsive. The **form runtime**, **expression engine** and **schema** packages are platform-agnostic TypeScript, so React Native can reuse them unchanged. All IDs are **client-generated UUIDv7**, and all writes are **idempotent commands**.
- **Later:** an **Expo / React Native** app with SQLite.
  - **Sync scope:** the user downloads a "sync bundle" for a project, made up of published form versions, the entities in their permitted subtree (optionally filtered), lookups and the theme.
  - **Pull:** incremental, using a per-scope change cursor (a `change_log` sequence on the server).
  - **Push:** a queue of commands (`submission.create`, `entity.update`) with retry and idempotency.
- **Conflict strategy:**
  - **Submissions are append-only**, so they never conflict.
  - Entity attribute edits are **field-level last-writer-wins using hybrid logical clocks**, with a per-attribute `source_priority`. Fields marked `conflict: manual` go to a conflict review queue instead.
  - Deletes are tombstones.
  - Server-side validation can reject a command, and the device shows it as "needs attention".

## As built (`apps/mobile`, `packages/offline`)

The first mobile app is **collection only**: it sends submissions up and downloads read-only data.

- **Up:** `submission.create` only, through an outbox (SQLite) with client-made UUIDv7 ids. Entity edits and the hybrid-clock conflict rules above are **not** used by the app; submissions never conflict.
- **Down:** published form versions (any version a submission was started on is accepted by the server), the places of each project via `GET /tenants/:t/projects/:p/entities/sync` (changed since a time, paged by id, final page lists the visible ids), and the person's own submissions (`?mine=true`, read only).
- **Triggers:** a connection coming back, the app opening, every five minutes while open, a background task every 15 minutes (upload only), and a manual **Sync now**.
- **Auth:** the `grids-mobile` public client (code + PKCE, `grids://auth/callback`); refresh token in secure storage. Forms opened from a link work without an account.
- **Rejections:** a 4xx other than 401/408/425/429 parks the submission as *needs attention* with the server's message. A 401 stops the run and keeps everything queued.
