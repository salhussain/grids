# Grids Mobile

Offline data collection for phones (iOS and Android), built with Expo / React Native.

- **Fill in without a connection.** Forms, and the places their questions offer, are kept on the device.
- **Sends upwards only.** Finished forms wait in the outbox and are sent when there is a connection, or when the person taps **Sync now**. Nothing is edited from the phone afterwards.
- **Down:** published forms, the places of each project (kept up to date with only what changed), and the person's own past submissions (read only).
- Also fills forms opened from a **link** (no account), when the link does not need an online check (email code, puzzle).

## Run it

Needs Node 22+ and a development build (the app uses native modules, so Expo Go is not enough).

```sh
cp apps/mobile/.env.example apps/mobile/.env.local   # point it at the API and the identity service
pnpm --filter @grids/mobile ios       # or: android
```

On a phone, `localhost` is the phone: use the computer's address in `.env.local`. Native builds can fail when the project's folder path contains spaces; work from a path without them.

The identity service knows the app as the client `grids-mobile` (redirect `grids://auth/callback`).

## How it works

| Piece | Where |
| --- | --- |
| Sending engine (queue, retries, pictures first) | [packages/offline](../../packages/offline) |
| Device database (outbox, places, forms) | `src/db.ts`, `src/store/` |
| Sync rounds, reconnect and background triggers | `src/sync.ts` |
| Form screen and question widgets | `src/form/` |
| Sign-in (code + PKCE, refresh token in secure storage) | `src/auth.ts` |

**Outbox.** Each submission has a client-made id, so sending it twice never duplicates. Pictures and files go first and their ids replace the `local:` placeholders in the answers. Offline stops the run and tries again at the next connection with no delay; server trouble backs off from 30 seconds to an hour; a rejection (the server says the answers are wrong) is parked as **Needs attention** with the server's message until the person fixes or resends it.

**Old form versions.** A form is sent against the version it was filled in on. The server accepts any published version, so a form republished while a submission waits still goes through.

**Places.** `GET …/entities/sync` returns what changed since the last sync; the last page lists every id still visible so removed places are dropped. The cursor only moves after a complete download.

**Signing out** keeps unsent forms on the device; they are sent when the same account signs in again.

## Not in the app (yet)

- Form translations (forms show in their original language).
- Links that check an email address or a puzzle at sending time.
- Resubmitting submissions that were sent back for changes.
