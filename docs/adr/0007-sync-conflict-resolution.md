# ADR 0007: Field-level last-writer-wins with hybrid logical clocks, plus manual-conflict opt-in

- Status: Accepted (2026-10-02). Implementation is post-MVP.

## Decision

Offline entity edits are idempotent commands stamped with hybrid logical clock timestamps. The server resolves per attribute: higher source priority wins, then the later timestamp. Attributes marked `conflict: manual` go to a review queue. Deletes are tombstones. Pull uses a per-scope `change_log` cursor.

## Alternatives

CRDTs everywhere (complex, unnecessary for form-style data), or whole-record last-writer-wins (loses concurrent edits to different fields).
