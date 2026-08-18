---
version: 2.0
name: Rounded Civic Workspace
description: The implementation contract for the DocAI frontend. A quiet neutral canvas, a persistent navigation rail, and one large rounded workspace holding the current task. Be Vietnam Pro throughout, calm blue action color, soft geometry with disciplined hierarchy. Light mode default, dark mode structurally identical.
---

# DocAI — Design System

**Visual system:** Rounded Civic Workspace.

**Authoritative specification:** `docs/superpowers/specs/2026-08-08-rounded-civic-workspace-design.md`.
That document is the visual and behavioral source of truth. This file is the concise
implementation contract: the normative token values, the type ramp, and the rules a
change must satisfy to be part of the system.

This system supersedes every earlier visual direction in this repository. The former
dark-only design language and the Apple-inspired specification dated 2026-07-17 are no
longer normative for any surface. Their tokens, type ramps, tile compositions, and
component grammars must not be reintroduced.

Product truth — users, purpose, personality, anti-references, accessibility — lives in
`PRODUCT.md` and is unchanged by this document.

## Reference hierarchy

When evidence conflicts, resolve in this order:

1. Real API types, route behavior, and existing tested product behavior.
2. `PRODUCT.md` and the accessibility contract below.
3. The authoritative specification.
4. This file.
5. Existing implementation styles, only as migration evidence.

Never invent product data to satisfy a visual composition. Folders, uploader
identities, file sizes, organizations, archives, sorting, recent activity, analytics,
and compliance verdicts do not exist unless a real backend contract supplies them.

## Typography

Be Vietnam Pro is the sole application UI family. JetBrains Mono is used only for
technical identifiers and machine-oriented values. Both load through
`next/font/google` in `app/layout.tsx`; no fonts are served from `public/fonts`.

| Role | Tailwind utility | Size / line height | Weight | Usage |
|---|---|---|---:|---|
| Page title | `text-page-title` | 28px / 36px | 700 | One page heading per route |
| Section title | `text-section-title` | 20px / 28px | 600 | Major sections and dialog titles |
| Body | `text-body` | 16px / 24px | 400 | Reading text and prominent row titles |
| Control | `text-control` | 14px / 20px | 500 | Buttons, navigation, filters, table headers |
| Metadata | `text-metadata` | 13px / 18px | 400 | Dates, counts, helper text |
| Technical | `text-technical` | 12px / 16px | 500 | IDs and dense machine values only |

Rules:

- Be Vietnam Pro loads weights 400, 500, 600, 700. JetBrains Mono loads 400, 500.
- Essential UI text is never smaller than 13px. `text-technical` is the only exception
  and is reserved for technical identifiers.
- No decorative italics. Do not italicize placeholder, provenance, source, or
  empty-state copy. `font-synthesis: none` is set on `body`.
- No negative letter spacing on Vietnamese UI text.
- Tabular numerals (`.numeric`) only for dates, counts, pagination, and measurements.
- Visible and accessible copy is Vietnamese. Technical identifiers and provider or
  model names may remain untranslated.

## Shape

| Token | Tailwind | Value | Usage |
|---|---|---:|---|
| `--radius-workspace` | `rounded-workspace` | 24px | Desktop authenticated workspace only |
| `--radius-panel` | `rounded-panel` | 16px | Panels, dialogs, popovers, grouped form sections |
| `--radius-control` | `rounded-control` | 12px | Buttons, fields, table rows, ordinary cards |
| `--radius-compact` | `rounded-compact` | 10px | Dense editor commands and small icon controls |
| `--radius-pill` | `rounded-pill` | 9999px | Status badges, toggles, search, compact filter chips |

One visual boundary represents one hierarchy level. Do not nest more than two bordered
rounded surfaces, and do not give every nested element its own border and radius.

## Color

Light mode is the default at `:root`. Dark mode is a `[data-theme="dark"]` override with
identical structure and meaning. Theme changes color only — never layout or hierarchy.

| Token | Light | Dark |
|---|---|---|
| `--color-canvas` | `#EEF1F5` | `#111318` |
| `--color-workspace` | `#FFFFFF` | `#181B22` |
| `--color-surface-subtle` | `#F6F7F9` | `#1E222B` |
| `--color-surface-strong` | `#ECEFF3` | `#272C36` |
| `--color-text-primary` | `#172033` | `#F5F7FB` |
| `--color-text-secondary` | `#5C667A` | `#C4CAD6` |
| `--color-text-muted` | `#646D80` | `#98A1B2` |
| `--color-action` | `#3157D5` | `#7C9BFF` |
| `--color-action-hover` | `#2748B9` | `#98AFFF` |
| `--color-hairline` | `#E1E5EA` | `#303642` |
| `--color-border-strong` | `#C9D0DA` | `#465063` |
| `--color-focus` | `#3157D5` | `#9CB3FF` |

Filled action controls use `--color-action`; action-colored *text* uses
`--color-action-text`, which carries the contrast needed against light surfaces and
dark canvases. Semantic success, warning, error, and info tokens meet WCAG 2.2 AA in
both themes and always pair with text or an icon. State is never encoded by color alone.

Light `--color-text-muted` is `#646D80`, not the `#768095` printed in the
specification: that value measures 3.97:1 on white and fails the specification's own AA
requirement. `#646D80` is the lightest value in the same hue that clears 4.5:1 on
canvas, workspace, subtle, and strong surfaces. `test/contrast.test.ts` enforces this.

## Elevation and motion

- Workspace shadow: `0 18px 50px rgba(22, 31, 52, 0.08)` in light mode; none in dark.
- Floating popover and dialog shadow: `0 16px 40px rgba(22, 31, 52, 0.14)`.
- Ordinary panels, rows, buttons, and fields are flat. `shadow-raised` and
  `shadow-flat` resolve to `none` and exist only for in-progress migration.
- No glows, blurred decorative backgrounds, animated orbs, or hover translation.
- State transitions run 150–220ms ease-out.
- Loading indicators may rotate. Under reduced motion, nonessential animation and
  continuous pulsing stop while progress text and state changes stay visible.

## Layout

At 1024px and above:

- 256px fixed sidebar, 16px outer canvas padding.
- One `rounded-workspace` container, minimum height `calc(100dvh - 32px)`, holding the
  route. No second global desktop header above it.
- Route title and actions live inside the workspace header.
- Account, theme, settings, and help controls live in the sidebar footer.
- Active navigation uses a pale action tint at 12–14px radius, not a full capsule.

Below 1024px: a 52px mobile header plus a modal navigation drawer that keeps the focus
trap, Escape close, outside-click close, inert background, and trigger-focus
restoration. The workspace radius is removed so content uses the full viewport.

Content width is route-specific. Data-management routes may use the full workspace
width; prose and forms keep readable maximums; editor routes may split panes.

## Component grammar

- Primary button: filled action blue, 12px radius, at least 44px high on touch layouts.
- Secondary button: surface with a hairline border. Ghost: no border until hover.
- Destructive: irreversible actions only, always paired with confirmation.
- Search may be pill-shaped. Ordinary inputs and selects are 12px with a persistent
  label, a helper/error slot, and a visible focus ring.
- Status badges: pill, localized label, icon or text support.
- Tables: one outer boundary, calm header band, 52–60px rows, whole-row hover, visible
  keyboard focus, no card around every cell.
- Empty states: state-specific explanation plus one useful next action.
- Dialogs: 16px radius, opaque surface, header/body/footer, focus trap, Escape, initial
  focus, and focus restoration.
- Toasts and live regions: semantic icon, concise Vietnamese copy. Critical information
  is never conveyed only transiently.

## Signature element

The **Document Confidence Strip** is the product-specific signature: a compact,
conditional trust summary near document review and export surfaces. It shows only real
values — template name, source count, generation state, fidelity result, validation
result, last check — and renders nothing when no trustworthy values exist. It never
labels an unavailable validation as passed.

## Accessibility contract

- WCAG 2.2 AA. Semantic headings, landmarks, skip links, labels, and live regions.
- Visible 2px focus ring with offset from the control edge.
- Primary touch targets at least 44 by 44px.
- Verified at 360px, 768px, 1024px, 1440px, and 200% browser zoom.
- Long Vietnamese titles wrap without clipping. No horizontal page scrolling at 360px.
- Reduced motion removes nonessential animation.

## Enforcement

- `test/design-system.test.ts` — source-level checks on fonts, tokens, the type ramp,
  and absence of legacy decorative APIs, tiny UI text, and raw shadow values.
- `test/contrast.test.ts` — computed AA contrast for light and dark token pairs.

A change is consistent with this system when both suites pass, no new raw color,
radius, shadow, or font-size literal is introduced, and every visible string is
Vietnamese unless it is a technical identifier.

## Known gaps

- No sort contract exists for documents; sorting controls must not be added.
- Template fidelity guarantees are shown only where the implementation substantiates them.
- Deprecated Tailwind aliases (`rounded-card`, `rounded-dialog`, `shadow-raised`,
  `shadow-flat`, `canvas-subtle`, `surface-raised`, `text-heading-2`, `text-caption`)
  remain only until route migration finishes, then are removed in Task 12.
