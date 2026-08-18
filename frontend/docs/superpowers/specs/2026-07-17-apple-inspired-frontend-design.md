# Apple-Inspired Frontend Adaptation Design

## Status

Approved on 2026-07-17 for the entire frontend. The existing light/dark theme toggle remains, and both themes will be rebuilt in the new design language.

## Objective

Translate the visual principles in the repository's root `DESIGN.md` into DocAI without turning a productivity application into an Apple storefront. Public pages may use the source system's spacious editorial expression. Authenticated screens must use the same palette, typography, radii, and restraint in a denser product register suited to document work.

This is a visual and interaction-system migration. Existing routes, API behavior, authentication, document workflows, settings behavior, and Vietnamese content remain functionally unchanged unless a small copy adjustment is necessary for consistency or accessibility.

## Interpretation and Source of Truth

"Apple-inspired" means borrowing Apple's hierarchy, product-first composition, typographic confidence, disciplined spacing, limited action color, and near-invisible chrome. It does not mean copying Apple's navigation taxonomy, retail tile sequence, logos, product photography, marketing copy, or consumer-electronics presentation.

This specification is authoritative for DocAI. The root `DESIGN.md` remains a visual reference, but its observations are not universal rules: the landing page does not require a black global navigation bar, a product-specific second navigation row, or a mechanically alternating light/dark section sequence. When a pattern from `DESIGN.md` conflicts with DocAI's product context, accessibility requirements, or the current content, this specification wins.

The fidelity target differs by surface:

- Public pages should be recognizably Apple-inspired through composition and art direction, not merely through borrowed colors.
- Authenticated pages should feel like the same design system expressed as a dependable document tool. Familiarity, density, and workflow clarity take priority over resemblance to Apple.com.
- Visual review compares principles and quality, never pixel similarity or brand imitation.

## Current State

The frontend is a Next.js 16 and React 19 application using Tailwind CSS 3, Radix primitives, Monaco Editor, next-themes, Vitest, and Testing Library. Its current styling is a deep-space glassmorphic system built around translucent panels, purple-indigo accents, glow shadows, decorative gradients, floating background orbs, and page-load animation.

The repository has a clean baseline:

- `npm test -- --run`: 16 files and 92 tests pass.
- `npm run lint`: passes with zero warnings.
- Git was clean before planning documents were added.

## Design Translation

### Physical scene

A public-sector document specialist works for several hours at a desktop under ordinary office lighting, moving between a source panel, a generated draft, validation feedback, and official templates. The interface should stay quiet and legible over long sessions, while the public landing page may communicate more confidence and ceremony.

### Color strategy

Use a restrained product palette in the authenticated application and a selectively committed palette on public surfaces.

- Apple Link Blue `#0071e3` is the primary filled-action color in light mode. Accessible text links may use the darker Action Blue `#0066cc` when the lighter blue does not meet contrast for the rendered size and weight.
- Sky Link Blue `#2997ff` provides accessible actions and links on dark surfaces.
- Light theme uses white, `#f5f5f7`, `#e8e8ed`, near-black ink, and soft gray hairlines.
- Dark theme uses true black `#000000` with system-dark surfaces `#1c1c1e` and `#2c2c2e`, white primary text, and theme-specific muted text that meets contrast requirements.
- Success, warning, error, and informational colors remain as semantic state tokens. They are not used decoratively and always appear with text or icon support.
- Decorative CSS gradients, purple accents, glow shadows, background grids, and animated orbs are removed.
- Public section canvases are chosen to support their content. Do not force a white/parchment/dark zebra pattern. Dark sections are used only when a document, workflow composition, or narrative moment benefits from the contrast.
- Real screenshots and art-directed workflow imagery may contain natural color, tonal falloff, or gradient-like lighting. The ban applies to decorative interface effects, not to color already present in meaningful visual content.

### Typography

Use separate display and text stacks so Apple devices receive the native SF voice while other platforms receive a deliberate open fallback:

- Display: `"SF Pro Display", -apple-system, BlinkMacSystemFont, var(--font-inter), "Segoe UI", sans-serif`.
- Text/UI: `"SF Pro Text", -apple-system, BlinkMacSystemFont, var(--font-inter), "Segoe UI", sans-serif`.
- Monospace: `"SF Mono", "JetBrains Mono", ui-monospace, monospace`.

Configure Inter Variable through `next/font/google` with `variable: "--font-inter"`. The generated font assets remain self-hosted by Next.js at runtime. Do not package or distribute Apple's proprietary SF Pro; the named SF faces are opportunistic local system choices only.

Public typography does not use Tailwind's generic `text-4xl`/`text-5xl` ladder directly. Tailwind aliases map to named design tokens with the following desktop targets:

| Token | Size | Weight | Line height | Tracking | Use |
|---|---:|---:|---:|---:|---|
| `display-hero` | 72px | 600 | 1.02 | `-0.025em` | Public landing hero, maximum two lines |
| `display-xl` | 56px | 600 | 1.05 | `-0.02em` | Major public editorial sections |
| `display-lg` | 40px | 600 | 1.10 | `-0.015em` | Secondary public sections |
| `product-title` | 32px | 600 | 1.16 | `-0.012em` | Authenticated page titles |
| `product-heading` | 24px | 600 | 1.20 | `-0.008em` | Product section headings and dialogs |
| `body-reading` | 17px | 400 | 1.47 | `-0.01em` | Public copy and document-oriented prose |
| `body-ui` | 15px | 400 | 1.40 | `-0.006em` | Product controls and ordinary UI copy |
| `caption` | 13px | 400 | 1.38 | `-0.004em` | Metadata and supporting labels |
| `nav` | 12px | 400 | 1.33 | `-0.01em` | Compact global navigation |

`display-hero` scales with `clamp(2.75rem, 5.5vw, 4.5rem)` and `display-xl` with `clamp(2.25rem, 4.2vw, 3.5rem)` on public pages. Product typography stays fixed rather than fluid. Headings use balanced wrapping, prose uses pretty wrapping, and body line length is capped near 70 characters when the content is not tabular or editor-based. Vietnamese diacritics are visually checked at every display size rather than assumed to fit from Latin-only samples.

### Shape, borders, and elevation

- Full-bleed editorial sections remain square and use surface changes as dividers.
- Compact product controls use 10–12px radii. Product cards and workbench panels use 14–16px radii; public utility cards may use 18px; dialogs and substantial sheets use 20px. No card or dialog exceeds 22px.
- Primary and secondary CTA buttons use full capsule radii. Search inputs, compact filters, and status chips may also use capsules when the shape clarifies their affordance. Dense toolbar controls and ordinary text inputs retain the 10–12px control radius so the product does not become a field of pills.
- Controls use hairline borders or a small, sharply defined elevation, never a wide shadow combined with a border.
- The document sheet or preview may receive a restrained shadow when it needs separation from a workbench surface. Navigation, ordinary cards, buttons, panels, and text remain flat and do not glow.
- Full-width editorial imagery and document canvases are never rounded merely to appear friendly. Their geometry follows the content hierarchy.

### Motion

Authenticated-product motion communicates state only. Standard transitions last 150–250ms with an ease-out curve. Remove floating decoration, orchestrated page-load sequences, and hover transforms that move layout. Pressed buttons may use a brief scale reduction.

Public pages may use a small number of content-led transitions when they help present real workflow material: a media crossfade, a controlled horizontal sequence, or a subtle change between document states. These transitions must not delay access to content, run continuously behind reading text, or turn interface screenshots into floating decoration. Every transition has a reduced-motion alternative, and content remains visible without animation.

## Theme Architecture

Retain `next-themes` and the `data-theme` attribute. Rebuild the theme as semantic CSS custom properties rather than route-specific colors. Both themes expose identical token names for:

- canvas, subtle canvas, raised surface, strong surface, and editor surface;
- primary, secondary, and muted text;
- hairline, strong border, focus ring, and selection;
- primary action and primary action on dark;
- success, warning, error, and informational states;
- semantic z-index layers and motion durations.

The following variables are the normative base contract. Feature styles consume these semantic names instead of Tailwind Slate/Gray values or route-specific hex colors:

```css
:root {
  color-scheme: light;

  --font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont,
    var(--font-inter), "Segoe UI", sans-serif;
  --font-text: "SF Pro Text", -apple-system, BlinkMacSystemFont,
    var(--font-inter), "Segoe UI", sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace;

  --color-canvas: #ffffff;
  --color-canvas-subtle: #f5f5f7;
  --color-surface-raised: #ffffff;
  --color-surface-strong: #e8e8ed;
  --color-editor: #ffffff;

  --color-text-primary: #1d1d1f;
  --color-text-secondary: #6e6e73;
  --color-text-tertiary: #86868b;

  --color-action: #0071e3;
  --color-action-hover: #0077ed;
  --color-link: #0066cc;
  --color-on-action: #ffffff;
  --color-hairline: #d2d2d7;
  --color-focus: #0071e3;

  --radius-control: 12px;
  --radius-panel: 16px;
  --radius-card: 18px;
  --radius-dialog: 20px;
  --radius-pill: 9999px;

  --vibrancy-background: rgba(255, 255, 255, 0.72);
  --vibrancy-fallback: rgba(255, 255, 255, 0.96);
}

[data-theme="dark"] {
  color-scheme: dark;

  --color-canvas: #000000;
  --color-canvas-subtle: #1c1c1e;
  --color-surface-raised: #1c1c1e;
  --color-surface-strong: #2c2c2e;
  --color-editor: #1c1c1e;

  --color-text-primary: #f5f5f7;
  --color-text-secondary: #a1a1a6;
  --color-text-tertiary: #86868b;

  --color-action: #2997ff;
  --color-action-hover: #54a9ff;
  --color-link: #2997ff;
  --color-on-action: #000000;
  --color-hairline: #38383a;
  --color-focus: #2997ff;

  --vibrancy-background: rgba(0, 0, 0, 0.60);
  --vibrancy-fallback: rgba(0, 0, 0, 0.94);
}
```

`--color-text-tertiary` is reserved for disabled, decorative, or sufficiently large text. It is not used for normal body copy, placeholders, helper text, or essential metadata on white because `#86868b` does not meet the 4.5:1 requirement there. Semantic success, warning, error, informational, selection, and diff tokens are added alongside this base contract and verified independently in both themes.

Functional vibrancy is a separate semantic treatment, not a return to glassmorphic cards:

```css
.surface-vibrant {
  background-color: var(--vibrancy-fallback);
}

@supports ((-webkit-backdrop-filter: blur(20px)) or
          (backdrop-filter: blur(20px))) {
  .surface-vibrant {
    background-color: var(--vibrancy-background);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
    backdrop-filter: saturate(180%) blur(20px);
  }
}

@media (prefers-reduced-transparency: reduce) {
  .surface-vibrant {
    background-color: var(--vibrancy-fallback);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
```

Use `.surface-vibrant` only for sticky or floating chrome where content visibly passes behind the element: the public global header, the authenticated top header, portal menus/popovers, and the floating StreamingDocumentEditor toolbar. Cards, dialogs, sidebars, forms, document panels, and page sections remain opaque. Every vibrant surface has the opaque fallback above and a hairline boundary when needed for separation.

Tailwind aliases point to these semantic variables. Old implementation names such as `bg-glass`, `shadow-glow`, and `.glass-panel` are removed after all consumers migrate; no long-lived compatibility layer remains.

The theme toggle stays available on the public header and authenticated header. Theme changes alter color only, not component dimensions, hierarchy, navigation placement, or meaning.

The public theme toggle is a deliberate DocAI product requirement and an explicit departure from Apple.com. Public compositions retain the same focal hierarchy in both themes; only semantic surfaces, text, and theme-aware interface captures change.

## Shared Component System

Shared primitives become the enforcement point for the migration:

- `Button`: primary, secondary, link-chevron, ghost, destructive, and icon variants with consistent hover, focus, active, disabled, and loading behavior. Primary and secondary CTA variants are 44px minimum height, use `--radius-pill`, and reserve horizontal space around the label instead of appearing as tight utility rectangles. The link-chevron variant is borderless Action Blue text with a small trailing `ChevronRight`; it is used for navigation such as "Tìm hiểu thêm," never for form submission or destructive actions. Ghost and dense toolbar buttons retain `--radius-control` rather than becoming capsules.
- `Card`: flat, outlined, and elevated variants using opaque semantic surfaces without decorative glass blur. Product cards use `--radius-panel`; public utility cards may use `--radius-card`. A card never combines a hairline border with a wide soft shadow.
- `Input` and `Textarea`: standard label, helper, placeholder, focus, disabled, and error styling using `--radius-control`. Search inputs may use `--radius-pill`; ordinary form fields do not.
- `Select`: visually aligned with inputs; portal content uses an opaque or functionally vibrant raised surface, uses `--radius-panel`, and cannot be clipped.
- `Badge`: restrained neutral and semantic variants; state never relies on color alone.
- `Toast`: semantic icon, title, description, and accessible live-region behavior on an opaque raised surface.
- Dialogs: one shared opaque overlay/content vocabulary using `--radius-dialog`, with consistent focus, spacing, close behavior, responsive sizing, and semantic stacking.

The shared component grammar distinguishes editorial CTAs from task controls. Public-page actions and high-confidence primary product actions use capsules; compact editor commands, table actions, segmented controls, and destructive confirmations use conventional control geometry. This preserves Apple's softness without reducing scan efficiency in dense workflows.

Tests should assert variant contracts, accessible names, state semantics, and theme invariance rather than brittle Tailwind class strings.

## Surface Design

### Public landing page

Replace the current neon glass hero with a compact single-row global header and a document-first editorial narrative. The sticky header is 44–52px high, uses `.surface-vibrant` with its opaque fallback, keeps the DocAI identity and essential account/theme actions, and avoids a second navigation row unless a future public subpage has genuine subordinate navigation. It must not imitate Apple's retail category navigation.

The first viewport communicates three things within five seconds: what the user provides, what DocAI produces, and why the result is dependable. The hero uses `display-hero`, a confident solid headline of no more than two lines, concise supporting copy of no more than three lines at desktop width, one primary capsule action, and one borderless link-chevron action. A second capsule is allowed only when both actions represent equally concrete destinations; do not render every marketing link as a filled button.

The dominant hero visual is one high-fidelity product-workflow composition built from real DocAI interface content. It occupies approximately 55–70% of the initial desktop viewport height and treats the generated administrative document as the focal object, supported by source, validation, or template evidence. It must not become three equal feature cards, a miniature dashboard grid, a browser-window mockup with decorative traffic-light dots, or a collection of floating glass panels. The composition may be rendered from live HTML or a maintained interface capture; it is not decorative AI imagery.

The composition requires deliberate art direction:

- Desktop and mobile define different crops or arrangements rather than merely scaling the same wide image.
- Text and the document focal point retain intentional clear space at 320px, 375px, 768px, 1024px, and 1440px.
- Full-width hero media remains square to the page edge or sits on an unrounded canvas; it is not placed inside a large rounded card.
- Above-the-fold visual assets use AVIF or WebP where applicable, declare intrinsic dimensions, and avoid layout shift. The desktop LCP visual should target at most 350KB and the mobile alternative at most 200KB.
- The hero visual loads eagerly only when it is the LCP element. Later editorial media loads lazily with responsive `sizes` and source selection.

After the hero, the narrative uses content-led section types rather than a repeated template:

1. A generation section showing source-to-document transformation with the document still dominant.
2. A retrieval or citation section using an asymmetric composition that makes evidence and provenance easy to inspect.
3. A compliance and template-fidelity section that may use a dark canvas when the contrast materially strengthens the visual.
4. A concise closing action that restates the product outcome without repeating the hero.

Full-width white, neutral, tinted, and near-black canvases are selected by the content; they do not alternate mechanically. Comparable items may use cards, but explanatory sections should prefer editorial composition, split layouts, real document surfaces, or progressive evidence. The footer uses a quiet neutral counterpart with only the navigation and legal information DocAI actually needs; it does not reproduce Apple's large retail sitemap.

### Authentication

Login and signup use a focused split or centered composition with restrained product context, one form surface, clear error placement, and an easy route back to the public page. They remain compact on mobile and avoid decorative glass or ambient animation.

### App shell

Keep the familiar sidebar and top-header information architecture because document specialists need stable access to generation, retrieval, templates, and settings. Restyle it as lightweight Apple-like chrome rather than a conventional 256px enterprise rail.

On wide screens the sidebar targets 224–232px, sits on `--color-canvas-subtle`, and is borderless, shadowless, and opaque. It is not a rounded card and does not blur the workbench behind it. Navigation rows are 40–44px high with 10–12px internal radii; the current item uses a quiet selected surface plus Action Blue text or icon emphasis, not a colored side stripe or glow. Section labels remain sparse and do not become repeated uppercase eyebrows.

The authenticated header is 52px high and may use `.surface-vibrant` while content scrolls behind it. It preserves the mobile menu, theme toggle, settings, account actions, and semantic z-index scale, with a single half-pixel or 1px hairline only when the background does not provide enough separation. Main content uses a canvas-based layout with generous outer gutters and minimal framing; editor-heavy routes opt into a wider workbench.

At tablet widths the sidebar becomes collapsible according to usable document width. On mobile it becomes an opaque drawer rather than a persistent column. This visual migration does not introduce a new navigation hierarchy or hide primary destinations inside unlabeled icons.

### Dashboard

Replace the two identical glass cards with an asymmetric canvas that is closer to Apple's web-app surfaces without becoming a generic widget dashboard. One large primary module carries the recommended next document action or current work context. Two or three smaller supporting modules expose search, Q&A, templates, or recent activity according to available real data. Modules may use `--radius-panel` and quiet tonal separation, but they do not repeat the same icon-heading-paragraph card template.

Present the most likely next actions—generate a document, search documents, ask a question, or manage templates—through scale and spatial grouping. Empty/recent activity space should teach the workflow without inventing backend data. The document or recommended action remains more visually important than the surrounding widgets.

The first-time dashboard state explains the next useful action in plain Vietnamese and shows the relationship between sources, templates, generated documents, and validation. It must not require users to infer that workflow from icons alone. Returning users retain a direct, compact path to their most common tasks.

### Documents

Use a standard page header, a compact filter/search toolbar, a readable result list, and explicit loading, empty, error, and pagination states. Document rows/cards emphasize title, metadata, type, and action affordances. The detail dialog uses the shared dialog vocabulary and retains export behavior.

### Generate workspace

Treat the generated document as the center of gravity. Use a responsive workbench: structured controls and sources on the supporting side, the Monaco-based document/editor area as the primary pane, and validation/fidelity/feedback as progressive supporting regions. At narrower widths, the layout stacks by task order instead of shrinking panels below usable widths. Streaming, generation progress, accept/reject, template mapping, and download states remain explicit and accessible.

Keep the source and template context needed for a decision visible alongside the generated result so users do not have to memorize information from a previous panel. Existing cancel, accept/reject, close, and navigation behavior remains available and visually obvious. This migration does not invent new undo, autosave, bulk-action, or draft-recovery behavior; those require separate functional specifications.

### Q&A

Use a document-focused conversation layout with a stable composer, clear user/assistant distinction without novelty chat bubbles, and source citations presented as expandable evidence. Empty state teaches what can be asked. Streaming and low-confidence states remain visible without pulsing glow.

### Templates

Unify upload, status, preview, mapping review, compatibility, and fidelity states. Template items use a compact list or asymmetric layout instead of identical glass cards. Status uses semantic badges plus labels. Upload and review dialogs use the common dialog system.

### Settings and dialogs

Keep settings in dialogs because the existing workflows and tests already establish them, but standardize shell, section hierarchy, unsaved-change confirmation, error summaries, and responsive behavior. Avoid adding new modals where inline disclosure is sufficient.

### Editors and document previews

Monaco light and dark themes must follow the application theme rather than remain hard-coded to light. Editor chrome, diff colors, toolbars, and status rows use shared tokens. Document preview surfaces resemble a clean sheet/workbench and reserve elevation for the document itself.

The StreamingDocumentEditor floating toolbar uses `.surface-vibrant`, `--radius-panel`, a subtle hairline, and compact control-radius buttons. It may float above the document because content passes behind it; permanent editor side panels and validation regions remain opaque. The toolbar becomes an opaque docked surface when reduced transparency is requested or when the mobile layout cannot preserve readable contrast behind it.

### Global states

Loading, route errors, not-found, empty states, skeletons, toasts, and validation panels share the same visual and semantic vocabulary. Loading content uses skeletons where layout is known; compact indeterminate actions may retain a spinner. Error and warning treatments use full boundaries or tinted surfaces, never colored side stripes.

## Responsive Strategy

- Wide desktop: persistent sidebar and wide editor workbench.
- Small desktop/tablet: persistent or collapsible sidebar according to available task width; two-column workbenches collapse when either pane would become unusable.
- Mobile: drawer navigation, single-column page flow, sticky actions only where they preserve context, and minimum 44px interactive targets.
- Public editorial sections reduce display typography and spacing at the `DESIGN.md` breakpoints, but product typography remains fixed and compact.
- Public hero and editorial visuals use breakpoint-specific art direction. A desktop screenshot may recompose into stacked live interface regions or use a dedicated mobile capture; cropping must never remove the document title, primary state, or evidence needed to understand the story.
- Public pages keep the primary action within the natural reading flow on mobile. Sticky actions are reserved for long, task-oriented authenticated workflows, not added to the landing page for imitation.
- Long Vietnamese headings and labels are tested for wrapping at 320px, 375px, 768px, 1024px, and 1440px.

## Accessibility and Quality Requirements

- WCAG 2.2 AA contrast in both themes, including placeholders, muted copy, focus rings, semantic states, and Monaco-adjacent controls.
- Keyboard navigation for shell, menus, forms, selects, dialogs, editors, pagination, and expandable source evidence.
- Focus remains visible and returns correctly after dialogs close.
- Skip links and landmark structure remain intact.
- No meaning is conveyed by color alone.
- Reduced motion disables nonessential animation and shortens state transitions.
- No horizontal overflow at supported widths.
- User workflows, API payloads, route paths, and auth/session behavior remain unchanged.
- Public imagery has meaningful alternative text when it communicates workflow information; purely redundant decoration uses empty alt text. Complex workflow compositions receive a concise text equivalent adjacent to the visual rather than an overloaded alt attribute.
- High-stakes validation, mapping, and fidelity decisions include brief contextual guidance or an accessible explanation trigger. Icons never carry these decisions without text.
- Public-page performance targets a Lighthouse performance score of at least 90 using Lighthouse's standard mobile preset with simulated throttling against a locally served production build, with no avoidable layout shift from hero or editorial media.

## Testing Strategy

Use the existing Vitest and Testing Library suite as the behavioral baseline. Add focused tests for shared primitive variants, theme toggle persistence, theme-aware Monaco selection, mobile navigation semantics, global states, and any structural change that affects accessible roles or names. Do not snapshot large class strings.

Visual verification covers landing, login, dashboard, documents, generation, Q&A, templates, dialogs, and representative loading/error/empty states in light and dark themes at mobile, tablet, and desktop widths. The landing review includes side-by-side reference inspection against the current Apple homepage for hierarchy, product dominance, typographic restraint, and quality of art direction—not for copied layout or pixel similarity.

Landing-page visual acceptance additionally verifies:

- a single compact global header rather than an unjustified two-row retail pattern;
- one dominant document/workflow hero composition rather than an equal-card grid;
- content-led canvas choices rather than forced light/dark alternation;
- deliberate desktop and mobile crops or recompositions;
- solid headline text with no decorative gradient, glow, or glass treatment;
- no rounded container around full-width editorial media;
- functional vibrancy limited to the header and named floating/portal chrome, with an opaque reduced-transparency fallback;
- stable layout and acceptable LCP asset weight in both themes.

Automated completion requires:

- `npm test -- --run`
- `npm run lint`
- `npm run build`

## Migration Approach

Use a token-first phased migration:

1. Establish product context, semantic tokens, typography, motion, theme parity, and Tailwind aliases.
2. Rebuild and test shared primitives.
3. Migrate the app shell and global states.
4. Migrate public landing and authentication surfaces.
5. Migrate authenticated routes and their feature components by workflow.
6. Remove legacy glass-panel/gradient/glow utilities, add the narrowly scoped `.surface-vibrant` treatment, and verify that no decorative glass consumers remain.
7. Run responsive, accessibility, visual, test, lint, and production-build checks.

This sequencing keeps each phase reviewable and avoids a long-lived compatibility layer. Route-by-route migration was rejected because it would temporarily mix two design languages. A CSS-only alias swap was rejected because it would retain misleading APIs and prevent shared components from enforcing the new interaction states.

## Out of Scope

- Backend or API changes.
- New document-generation, retrieval, template, or collaboration capabilities.
- Replacing Monaco Editor.
- Rewriting authenticated navigation or information architecture beyond presentation and responsive grouping.
- Introducing proprietary fonts or a new image-generation dependency.
- Literal reproduction of Apple logos, product photography, marketing copy, or brand assets.
- Reproducing Apple's retail navigation, product-category sitemap, promotional carousel content, or current homepage section order.
- Adding undo, autosave, draft recovery, new keyboard shortcuts, bulk actions, or other workflow capabilities as part of the visual migration.

## Acceptance Criteria

The migration is complete when every route and shared component uses the new semantic system in both themes; no legacy or decorative glass panels, glow, purple-gradient, floating-orb, or decorative-motion implementation remains; `.surface-vibrant` appears only on the explicitly allowed sticky, floating, and portal chrome; critical workflows retain behavior; accessibility requirements pass manual and automated checks; all baseline and added tests pass; lint and production build pass; and visual review confirms a coherent system from public landing through dense editor workflows.

System-wide visual acceptance additionally requires:

- Computed theme values match the normative Apple-neutral token contract; no Tailwind Slate, Gray, Indigo, or Purple palette value remains in shared chrome or ordinary feature surfaces.
- Apple devices resolve to the local SF display/text faces when available, while other platforms resolve to Inter Variable. Public hero typography reaches the `display-hero` scale at wide desktop and does not silently fall back to generic Tailwind heading steps.
- Primary and secondary CTA variants use capsule geometry, search uses capsule geometry, and the link-chevron variant remains borderless. Dense editor and toolbar controls retain control-radius geometry.
- Product panels, public utility cards, and dialogs resolve to their 16px, 18px, and 20px radius roles respectively; full-width editorial and document canvases remain unrounded.
- The desktop sidebar is a lightweight 224–232px borderless navigation plane, the authenticated header uses functional vibrancy, and the dashboard uses an asymmetric canvas rather than repeated equal cards.
- `#86868b` is not used for essential normal-sized text on white; placeholders and secondary body text meet WCAG 2.2 AA despite the Apple-inspired palette.

The public landing page is accepted only when it also meets all of the following:

- Its resemblance to Apple comes from hierarchy, whitespace, typography, product dominance, and execution quality rather than copied branding or a rigid tile formula.
- The first viewport makes DocAI's input, output, and trust proposition understandable within five seconds.
- One real document/workflow composition is the clear visual center of gravity and occupies the majority of the hero's visual area.
- No three-equal-card hero, decorative browser mockup, forced two-row header, or mechanical light/dark zebra sequence remains.
- Local SF faces resolve on supported Apple devices, Inter Variable renders correctly as the cross-platform fallback with Vietnamese content, and display typography follows the specified size, weight, tracking, and line-height limits.
- Mobile and desktop use intentional artwork crops or recompositions, meet the stated asset budgets, and introduce no horizontal overflow or avoidable layout shift.
- Public content transitions remain optional, restrained, and reduced-motion safe; authenticated motion remains state-driven.
- A side-by-side visual review can explain which Apple principles were translated and which Apple-specific patterns were deliberately rejected.
