# Template selection repair design

Date: 2026-07-18

## Problem

The template selector on `/generate` opens with only a placeholder row and no usable templates. The immediate frontend symptom is caused by a failed `GET /api/templates` request. The configured PostgreSQL database records `20260712184012_init_dynamic_templates` as applied, but the live `Template` table still has the legacy columns and does not contain `status`. The stored migration checksum also differs from the current migration file, showing that the applied migration was later modified.

The frontend then collapses an API failure and a legitimate zero-template result into the same `readyTemplates = []` state. It renders the empty value as a selectable option and tells the user to upload a template, even when the actual failure is the backend schema.

## Approved outcome

Repair the live schema without resetting or deleting user data, make template processing refresh automatically, and give Generate distinct loading, error, empty, and ready states. A user with a `READY` template must be able to select it and generate a document. A user without one must get a disabled control and a direct path to Templates. An API failure must be shown as an error, not as an empty library.

A `READY` template must also preserve the uploaded DOCX structure, including supported floating text boxes, and pass the typography rules in Appendix I of Decree 30/2020/NĐ-CP. The service must never silently replace a non-compliant font inside the downloadable DOCX.

## Architecture and data flow

### Database repair

Add a new forward-only Prisma migration. Do not edit, resolve, or replay the migration already recorded as applied. The repair migration must be idempotent against both the legacy table observed locally and databases where some dynamic-template columns already exist.

The migration will:

- ensure the `TemplateStatus` enum exists;
- add missing legacy compatibility fields (`header`, `signatureBlock`) and all dynamic-template fields;
- make `docType` nullable;
- create the disabled system owner when needed;
- backfill owner and retired status for legacy rows;
- apply defaults and non-null constraints after backfill;
- create the owner/status and owner/date indexes and owner foreign key safely;
- create `UserDocumentProfile` if absent;
- retain obsolete legacy columns rather than dropping them during this repair.

The last point keeps the migration non-destructive. Removing legacy columns can be handled separately after backups and deployment validation.

### DOCX fidelity and typography compliance

Use the approved hybrid policy: preserve the source document's structure and formatting, but block a template from becoming `READY` when its declared typography violates the rules.

The document renderer will treat the original DOCX as the authoritative shell:

- detect editable paragraphs in the document body, headers, footers, DrawingML text boxes, and VML text boxes;
- retain floating-shape geometry, wrapping, anchors, margins, borders, fills, and z-order;
- insert generated values by cloning the mapped paragraph and run properties instead of creating unstyled replacement runs;
- compare the pre-generation and post-generation structural fingerprints and fail closed on missing, moved, or changed shapes;
- reject unsupported or unaddressable grouped shapes instead of flattening or guessing.

Template analysis will expose resolved formatting metadata for each candidate, including declared font family, size in half-points, bold, italic, color, and whether the candidate is inside a text box. Resolution must account for direct run properties, paragraph/style inheritance, and theme fonts.

Before a template can become `READY`, the backend will validate that:

- Vietnamese administrative text declares Times New Roman with Unicode encoding and black text;
- mapped semantic roles use the size and style ranges defined in Appendix I, Part I, Section V of Decree 30/2020/NĐ-CP—for example body text 13–14 pt, the national heading 12–13 pt bold uppercase, the motto 13–14 pt bold, and role-specific recipient/signature sizes;
- all text-bearing mapped regions, including those inside supported text boxes, have resolvable formatting;
- renderer font substitution is reported for preview fidelity but never changes the font declared in the downloadable DOCX.

A typography or text-box compatibility violation sets the template to `REJECTED` with stable machine-readable codes such as `FONT_RULE_VIOLATION` or `UNSUPPORTED_DOCX_STRUCTURE`. The Templates UI will translate those codes into Vietnamese guidance that names the affected region and expected font rule, directing the user to correct the source DOCX and upload it again. Mapping review cannot override these violations.

### Templates page refresh

Keep the existing owner-scoped API. The Templates page will continue loading its own list, but while any template is `UPLOADED` or `ANALYZING`, it will schedule a bounded refresh. The timer stops when no template is processing and is cleaned up on unmount. Upload and mapping review completion trigger an immediate reload.

The page will preserve explicit states: loading, request error, empty library, processing, needs review, ready, rejected, and failed.

### Generate selector

The Generate page will use the template query's loading, error, and refetch state directly.

- Loading: disabled selector with a loading label.
- Error: disabled selector, inline error message, and retry action.
- Loaded with no `READY` template: disabled selector and link to `/templates`.
- Loaded with ready templates: only real templates appear as options; the Radix placeholder is not an item.

If a selected template disappears from the ready set after a refetch, the stale selection is cleared. Selecting a template with a document type continues to synchronize the document type.

## Error handling

Template-fetch errors remain local to the template field instead of being merged into the document-generation error banner. This prevents unrelated failures from overwriting each other and keeps recovery adjacent to the failed control.

Database deployment must fail visibly if the repair cannot establish the schema. The application must not silently interpret a schema error as an empty template library.

## Testing

Implementation follows test-driven development.

Backend/database checks:

- a schema smoke query can select the fields required by the templates route after migration;
- the new migration is safe on the observed legacy shape;
- existing backend tests continue to pass.

Renderer and fidelity regression tests:

- analyze and edit both DrawingML and VML text-box fixtures;
- preserve shape fingerprints and static package parts after insertion;
- preserve inherited Times New Roman declarations and mapped run/paragraph properties;
- reject Arial, Calibri, unresolved theme fonts, invalid colors, and role-specific font sizes outside the allowed range;
- keep the output DOCX font declaration unchanged when the local preview renderer substitutes an installed compatible font;
- prevent mapping review from promoting a template with typography or text-box violations to `READY`.

Frontend regression tests:

- Generate shows an API error and retry control when template loading fails;
- Generate disables the selector and links to Templates when no ready template exists;
- Generate lists only real `READY` templates and can select one;
- Templates refreshes while a template is processing and stops after it reaches a terminal or review state;
- existing Templates behavior remains intact.

Final verification includes Prisma validation and migration deployment, direct database schema inspection, focused regression tests, full frontend/backend tests, lint, production builds, and a live authenticated template flow when credentials are available.

## Out of scope

- deleting legacy template columns;
- redesigning the mapping algorithm or confidence thresholds;
- changing template ownership rules;
- adding new automatic layout-repair or content-shortening policies beyond the existing fidelity checks;
- automatically rewriting non-compliant template fonts or font sizes;
- resetting or reseeding user data.
