# 5. Dynamic forms/surveys

- **Form definition** is JSON validated by a Zod schema in `@grids/schema`. It has sections, questions (≈25 types including text, number, select, multi-select, date, GPS, photo, file, signature, barcode, entity-picker, matrix and repeat-group), validation, **skip logic and calculations** in a small sandboxed **expression language** (one evaluator in TypeScript shared by web, mobile and server), defaults and pre-fills from entity attributes, and attribute bindings and data-element mappings.
- **Versioning:** you edit a draft and then publish an immutable version. Submissions pin `form_version_id`, and migrations between versions are never required.
- **Submission storage:** `submission(id uuidv7 /* client-generated */, form_version_id, subject_entity_id, answers jsonb, submitted_by, collected_at, device_id, geo, status)`. A post-processor fans out to attribute changes and observations.
- The builder is a drag-and-drop UI writing the same JSON. XLSForm import/export (the ODK and DHIS2 ecosystem format) comes later.
