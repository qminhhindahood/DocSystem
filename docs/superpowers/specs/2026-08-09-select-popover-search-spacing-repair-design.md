# Select Popover and Search Spacing Repair Design

Date: 2026-08-09  
Status: Approved design, awaiting implementation plan

## Objective

Repair two narrow frontend defects without changing the Rounded Civic Workspace visual language:

1. Select menus opened from a modal must remain visible and interactive above the modal surface.
2. Search text with a leading icon must retain enough inline-start padding to avoid overlap.

## Confirmed root causes

### Select menu hidden behind the LLM settings dialog

The shared Radix Select content is portalled to `document.body` with `z-dropdown`, which resolves to 10. The dialog overlay and dialog content resolve to 1000. The menu therefore opens below the modal stacking layer even though its trigger changes to the open state.

### Document-search text overlaps its icon

`DocumentsToolbar` applies `pl-10` to the search input, but the global `.control-field` rule appears later in the stylesheet and sets both inline paddings to 14px with equal specificity. The semantic control rule wins the cascade, leaving insufficient clearance for the absolutely positioned icon.

## Approved repair

### Popover layering

- Add `--z-popover: 1050` to the design-system layering tokens.
- Expose it as Tailwind `z-popover`.
- Replace `z-10` on shared Select content with `z-popover`.
- Keep the hierarchy explicit: backdrop/modal 1000, popover 1050, toast 1100, tooltip 1200.
- Apply the repair in the shared Select so provider, model, and other portalled select menus behave consistently inside dialogs.

### Leading-icon field spacing

- Add a reusable `.control-field-leading-icon` modifier after `.control-field`.
- The modifier sets `padding-inline-start: 40px`, preserving right-to-left compatibility and winning the intended cascade without `!important`.
- Use the modifier on the document search field and remove the ineffective `pl-10` utility.
- Do not change field height, pill radius, icon position, placeholder copy, or search behavior.

## Accessibility and interaction

- Provider options remain keyboard navigable through the existing Radix Select behavior.
- The open list stays above the modal, receives pointer input, and keeps its existing 44px options.
- Search retains its programmatic name and 44px height.
- The icon remains decorative and `aria-hidden`.
- Light and dark themes use existing surface, text, border, focus, and shadow tokens.

## Testing and verification

- Add a shared Select regression assertion for the semantic popover layer.
- Add a DocumentsToolbar regression assertion for the leading-icon modifier.
- Run the targeted primitive, settings-dialog, and documents-page tests before and after the fix.
- Run the complete frontend tests, lint, typecheck, build, and one Impeccable detector pass.
- Confirm in Chrome that:
  - the provider menu opens above the settings dialog and all provider options are selectable;
  - the search icon and `Tìm kiếm tài liệu` text do not overlap at desktop and 390px mobile;
  - both states remain correct in light and dark themes;
  - no new console errors, clipping, or horizontal overflow appear.

## Non-goals

- No provider list, provider value, or settings payload changes.
- No search behavior, debounce, filtering, or copy changes.
- No modal, sidebar, document-page, or design-system redesign.
- No `!important`, arbitrary z-index literal, or local inline padding workaround.
