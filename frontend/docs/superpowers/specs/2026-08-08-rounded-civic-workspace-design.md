# Rounded Civic Workspace Redesign Specification

## Status and authority

This specification records the approved replacement visual direction for the complete DocAI frontend. It supersedes the Apple-inspired specification dated 2026-07-17 for all redesign decisions. Product behavior, backend contracts, authentication, and Vietnamese document workflows remain authoritative and must not be invented or simplified to match a visual reference.

When evidence conflicts, use this order:

1. Real API types, route behavior, and existing tested product behavior.
2. `PRODUCT.md` and the accessibility requirements in this specification.
3. This specification.
4. The supplied reference images for geometry, softness, density, and composition.
5. Existing implementation styles only as migration evidence or an anti-reference.

Visual references available on the development machine:

- Accepted DocAI composition: `C:\Users\PC\.codex\generated_images\019fd174-fa79-7d90-82b3-ba96897284af\exec-76a11dc8-19aa-454e-a624-24d5172d6f65.png`
- Rounded ProDeal geometry reference: `C:\Users\PC\AppData\Local\Temp\codex-clipboard-h6wnZp.png`
- Documents workspace reference: `C:\Users\PC\AppData\Local\Temp\codex-clipboard-TBA5fe.png`
- Impeccable critique snapshot: `.impeccable/critique/2026-08-08T12-10-38Z__app-app-documents-page-tsx.md`

The images are supporting evidence, not runtime assets. This document is complete enough to execute if an external image is unavailable.

## Job, audience, and visitor mode

Authenticated pages use **Operate** mode. Vietnamese public-sector staff and document specialists arrive to generate, inspect, retrieve, validate, and export official documents during focused, accuracy-sensitive work. The interface must feel calm, legible, and trustworthy over long desktop sessions while remaining fully operable on mobile.

Public and authentication pages may be more editorial, but they share the same typography, color tokens, and control grammar. They must never resemble a consumer-electronics storefront or a neon AI dashboard.

## Outcome and proof

The primary outcome is a user moving from source material or a known template to a reviewable Vietnamese document without losing confidence in provenance, formatting, or system state.

The interface proves this through:

- Explicit generation stages and progress.
- Visible source, template, validation, and fidelity information when the backend provides it.
- Predictable actions and safe export confirmation.
- Complete loading, empty, error, retry, disabled, pending, and success states.
- Stable layout, readable Vietnamese typography, and consistent focus behavior.

The product-specific signature is the **Document Confidence Strip**: a compact, conditional trust summary near document review and export surfaces. It may show only real values such as template name, source count, generation state, fidelity result, validation result, or last check. It is omitted when no trustworthy values exist.

## Selected direction

The visual world is **Rounded Civic Workspace**: a quiet neutral application canvas, a persistent navigation rail, and a large rounded workspace containing the current task. Soft geometry lowers visual friction; disciplined hierarchy keeps the interface professional rather than toy-like.

The references authorize:

- A pale neutral outer canvas in light mode.
- One large rounded workspace at desktop sizes.
- A calm blue action color.
- Fine borders, restrained shadows, generous row height, and rounded controls.
- Compact, scannable navigation and document-management layouts.

The references do not authorize browser chrome, fake organization data, folder models, uploader avatars, file sizes, sort controls, archive behavior, or “recent files” unless a real contract is added later.

## Design tokens

### Typography

Use Be Vietnam Pro as the sole application UI font and JetBrains Mono for technical identifiers. Load fonts with `next/font/google`; do not depend on files in `public/fonts`.

| Role | Size / line height | Weight | Usage |
|---|---|---:|---|
| Page title | 28px / 36px | 700 | One page heading per route |
| Section title | 20px / 28px | 600 | Major sections and dialog titles |
| Body | 16px / 24px | 400 | Reading text and prominent row titles |
| Control | 14px / 20px | 500 or 600 | Buttons, navigation, filters, table headers |
| Metadata | 13px / 18px | 400 or 500 | Dates, counts, helper text |
| Technical exception | 12px / 16px | 500 | IDs and dense machine-oriented values only |

Rules:

- Load Be Vietnam Pro weights 400, 500, 600, and 700.
- Load JetBrains Mono weights 400 and 500.
- Remove Inter, Plus Jakarta Sans, Playfair Display, Google Sans Flex, Google Sans Code, and Google Symbols from application typography.
- Remove decorative UI italics. Do not italicize placeholder, provenance, source, or empty-state copy.
- Set `font-synthesis: none` after all italic UI usage is removed.
- Do not use negative letter spacing for Vietnamese UI text.
- Use tabular numerals only for dates, counts, pagination, and technical measurements.
- Essential UI text is never smaller than 13px; 12px is limited to technical exceptions.

### Shape

| Token | Value | Usage |
|---|---:|---|
| `--radius-workspace` | 24px | Desktop authenticated workspace only |
| `--radius-panel` | 16px | Panels, dialogs, popovers, grouped form sections |
| `--radius-control` | 12px | Buttons, fields, table rows, ordinary cards |
| `--radius-compact` | 10px | Dense editor commands and small icon controls |
| `--radius-pill` | 9999px | Status badges, toggles, search, and compact filter chips only |

Do not give every nested element a border and rounded container. One visual boundary represents one hierarchy level. Avoid nesting more than two bordered rounded surfaces.

### Color

Light mode is the default.

Light foundations:

- Canvas: `#EEF1F5`
- Workspace: `#FFFFFF`
- Subtle surface: `#F6F7F9`
- Strong surface: `#ECEFF3`
- Primary text: `#172033`
- Secondary text: `#5C667A`
- Muted text: `#768095`
- Hairline: `#E1E5EA`
- Strong border: `#C9D0DA`
- Action: `#3157D5`
- Action hover: `#2748B9`
- Focus: `#3157D5`

Dark mode preserves the exact hierarchy and dimensions:

- Canvas: `#111318`
- Workspace: `#181B22`
- Subtle surface: `#1E222B`
- Strong surface: `#272C36`
- Primary text: `#F5F7FB`
- Secondary text: `#C4CAD6`
- Muted text: `#98A1B2`
- Hairline: `#303642`
- Strong border: `#465063`
- Action: `#7C9BFF`
- Action hover: `#98AFFF`
- Focus: `#9CB3FF`

Semantic success, warning, error, and information tokens must meet WCAG 2.2 AA in both themes and always include text or icon support. State is never encoded by color alone.

### Elevation and motion

- Workspace shadow: `0 18px 50px rgba(22, 31, 52, 0.08)` in light mode; no luminous dark-mode shadow.
- Floating popover/dialog shadow: `0 16px 40px rgba(22, 31, 52, 0.14)`.
- Ordinary panels, rows, buttons, and fields remain flat.
- No glows, blurred decorative backgrounds, animated orbs, or hover translation.
- State transitions use 150–220ms ease-out.
- Loading indicators may rotate; content must not pulse continuously when reduced motion is requested.

## Authenticated shell

At viewport widths of 1024px and above:

- Use a 256px fixed-width sidebar.
- Use 16px outer canvas padding.
- Place authenticated content in one `24px` rounded workspace with a minimum height of `calc(100dvh - 32px)`.
- Do not render a second global desktop header above the workspace.
- Put route-level title and actions inside the workspace header.
- Put account, theme, settings, and help controls in the sidebar footer.
- Active navigation uses a pale action tint and 12–14px radius, not a full capsule.

Below 1024px:

- Replace the persistent sidebar with a 52px mobile header and modal navigation drawer.
- Keep the existing focus trap, Escape close, outside-click close, inert background, and trigger-focus restoration behavior.
- Remove the outer workspace radius at narrow widths so content uses the full viewport.

The content width is route-specific. Data-management pages may use the full workspace width. Long prose and forms retain readable maximum widths. Document/editor routes may use split panes when enough width is available.

## Shared component grammar

- Primary button: filled Action Blue, 12px radius, at least 44px high on touch layouts.
- Secondary button: white/subtle surface with a hairline border.
- Ghost button: no border until hover; never glows.
- Destructive button: reserved for irreversible actions and paired with confirmation.
- Search: pill shape is allowed because the affordance benefits from it.
- Ordinary inputs and selects: 12px radius, persistent label, helper/error slot, visible focus ring.
- Status badges: pill shape, icon or text support, localized label.
- Tables: one outer boundary, calm header band, 52–60px rows, whole-row hover, visible keyboard focus, no card around every cell.
- Empty states: state-specific explanation plus one useful next action; no decorative giant icon.
- Dialogs: 16px radius, opaque surface, predictable header/body/footer, focus trap, Escape behavior, initial focus, and focus restoration.
- Toasts and live announcements: semantic icon, concise Vietnamese copy, no critical information conveyed only transiently.

## Surface specifications

### Documents

The Documents route is the reference implementation for the authenticated design system.

Header:

- Title `Tài liệu`.
- Real document count.
- Primary action `Tạo tài liệu` linking to `/generate`.

Toolbar:

- Search with 275ms debounce.
- Document-type filter.
- Status filter.
- `Xóa bộ lọc` appears only when filters are active.
- No sorting until the API supports a sort contract.

Desktop list columns:

- Tài liệu: title plus optional supported count metadata.
- Loại tài liệu.
- Cập nhật.
- Trạng thái.
- Row action affordance.

Use only `DocumentListItem`: `id`, `docType`, `title`, `status`, `createdAt`, `updatedAt`, and `_count`. Unknown statuses render a localized neutral fallback. Search and filters reset the page to one, preserve the previous result while fetching, and expose a row-level pending state while details load. On mobile, use labelled list rows without losing semantic relationships.

### Document detail and export

Place document identity and high-confidence actions first. Present the Document Confidence Strip before long content when data exists. Keep content, chunks/sources, feedback, generation metadata, fidelity warnings, and export actions clearly separated. Export confirmation states the filename, DOCX format, known validation/fidelity result, and action outcome. Do not claim a document is compliant when validation is unavailable.

### Generation

Organize the existing generation flow into four visible stages:

1. Thiết lập
2. Soạn nội dung
3. Kiểm tra
4. Xuất tài liệu

Map existing stream stages to this presentation without changing the SSE contract. Preserve cancellation before the first chunk and during streaming. EOF without a terminal event is an error, not success. On failure, retain user inputs and generated content already received. Repeat users should be able to proceed without re-reading onboarding copy.

### Templates

Keep the real template lifecycle: loading, processing, review required, ready, rejected, failure, and empty. Show fidelity guarantees only when the current implementation can substantiate them. Mapping review is a focused workflow with back, review, correction, and completion actions. Deletion requires confirmation and row/card-level pending feedback.

### Dashboard

Lead with one clear `Tạo tài liệu` action and compact supporting access to Documents and Templates. Do not add fake analytics or recent activity. Product trust comes from workflow clarity, not vanity metrics.

### Authentication and public pages

Authentication forms use a compact rounded panel, persistent labels, complete validation, password visibility control, and existing redirect behavior. Public pages may use more editorial spacing but must retain one primary action, meaningful product proof, and the same font/color system. Remove legacy glow, tiny navigation text, and decorative visual noise.

### Settings, errors, and system states

Settings use grouped form sections with clear save state, dirty-state protection where already implemented, and responsive dialogs. Loading, 404, route error, and fatal error pages use the same typography and provide a clear recovery action. All visible and accessibility copy is Vietnamese unless a technical identifier must remain unchanged.

## Accessibility and responsive contract

- Target WCAG 2.2 AA.
- Preserve semantic headings, landmarks, skip links, labels, status messages, and live regions.
- Preserve a visible `2px` focus ring with separation from the control edge.
- Primary touch targets are at least 44 by 44px.
- Test at 360px, 768px, 1024px, 1440px, and 200% browser zoom.
- Long Vietnamese titles wrap without clipping; tables and toolbars do not force horizontal page scrolling at 360px.
- Reduced motion removes nonessential animation.
- Theme changes color only; they do not change layout or meaning.

## Scope boundaries

Included:

- All frontend routes and shared UI components.
- Typography, token, shell, responsive, accessibility, and localized-copy consistency.
- Refactoring necessary to create focused shared UI boundaries.
- Tests that protect the new design contract and existing behaviors.

Excluded:

- Backend, database, or API schema changes.
- New folders, organizations, uploaders, file sizes, archive, sort, or collaboration features.
- New npm dependencies unless a current dependency cannot meet an approved requirement.
- Replacing Monaco, React Query, Radix, or next-themes.
- Rewriting working business logic merely to achieve visual uniformity.

## Completion evidence

The redesign is complete only when:

- The implementation matches this specification across every route.
- Existing product behavior remains tested.
- Unit/component tests, lint, typecheck, and production build pass.
- The Impeccable detector has no unexplained design-system findings.
- Authenticated browser QA covers desktop and mobile, both themes, keyboard use, reduced motion, loading, empty, error, and long-content states.
- One bounded visual repair pass is completed from a batched desktop/mobile screenshot review, followed by one confirmation pass.
