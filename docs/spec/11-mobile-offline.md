# 11. Mobile & offline-first (designed now, built post-MVP)

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
