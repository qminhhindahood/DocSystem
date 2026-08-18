# Frontend Redesign: Modern Enterprise Government UI
**Date:** 2026-06-20  
**Status:** Draft  
**Author:** Claude (Anthropic)  
**Project:** AI Document System for Vietnamese Government  
**Branch:** `frontend/redesign-modern-enterprise`

---

## Executive Summary

Comprehensive frontend redesign to improve visual design, user experience, accessibility, and add missing features (mobile responsive, dark mode, template gallery). The current Next.js 14 + Tailwind app is functional but inconsistent. This spec defines a modern, enterprise-grade design system using Radix UI primitives, WCAG 2.1 AA compliance, and responsive layouts that work on desktop, tablet, and mobile.

**Out of scope:** Full backend changes; only `/api/analytics/track` endpoint addition needed.

---

## Goals

1. **Visual Design:** Professional, trustworthy appearance suitable for government document generation; consistent design language across all pages.
2. **User Experience:** Reduce friction in document creation; clearer workflows; better feedback and error handling.
3. **Accessibility:** Achieve WCAG 2.1 AA compliance; keyboard navigation; screen reader support.
4. **Responsive:** Mobile-first approach; works on phones, tablets, and desktops.
5. **Dark Mode:** Manual toggle, persisted preference.
6. **Template Gallery:** Browse and select predefined Decree 30/2020 document templates.

---

## Non-Goals

- Complete rewrite in a different framework (stay on Next.js 14 App Router)
- Internationalization beyond Vietnamese/English (i18n deferred)
- Advanced Monaco editor features (find/replace, spell check deferred)
- Multi-user collaboration
- Advanced analytics dashboard

---

## Design System

### Typography

```css
--font-sans: Inter, system-ui, sans-serif;
--font-mono: JetBrains Mono, monospace;

--text-xs: 0.75rem (12px) line-height 1.5;
--text-sm: 0.875rem (14px) line-height 1.5;
--text-base: 1rem (16px) line-height 1.6;
--text-lg: 1.125rem (18px) line-height 1.5;
--text-xl: 1.25rem (20px) line-height 1.5;
--text-2xl: 1.5rem (24px) line-height 1.3;
--text-3xl: 1.875rem (30px) line-height 1.2;
--text-4xl: 2.25rem (36px) line-height 1.1;
```

Headings use weights 600/700; body uses 400/500.

### Color Palette (CSS Variables)

```css
:root {
  --bg-primary: #FFFFFF;
  --bg-secondary: #F8FAFC;
  --bg-tertiary: #F1F5F9;
  --text-primary: #111827;
  --text-secondary: #6B7280;
  --text-tertiary: #9CA3AF;
  --accent-primary: #2563EB;
  --accent-hover: #1D4ED8;
  --accent-light: #DBEAFE;
  --border: #E5E7EB;
  --border-focus: #93C5FD;
  --success: #059669;
  --success-light: #D1FAE5;
  --warning: #D97706;
  --warning-light: #FEF3C7;
  --error: #DC2626;
  --error-light: #FEE2E2;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1);
}

[data-theme="dark"] {
  --bg-primary: #0F172A;
  --bg-secondary: #1E293B;
  --bg-tertiary: #334155;
  --text-primary: #F9FAFB;
  --text-secondary: #9CA3AF;
  --text-tertiary: #6B7280;
  --accent-primary: #3B82F6;
  --accent-hover: #60A5FA;
  --accent-light: #1E3A8A;
  --border: #374151;
  --border-focus: #60A5FA;
  --success: #34D399;
  --success-light: #064E3B;
  --warning: #FBBF24;
  --warning-light: #78350F;
  --error: #F87171;
  --error-light: #7F1D1D;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
}
```

### Spacing Scale

Tailwind config extended:

```js
spacing: {
  '1': '4px', '2': '8px', '3': '12px', '4': '16px',
  '5': '20px', '6': '24px', '8': '32px', '10': '40px',
  '12': '48px', '16': '64px', '20': '80px', '24': '96px',
}
```

### Breakpoints

```js
screens: {
  'sm': '640px',
  'md': '768px',
  'lg': '1024px',
  'xl': '1280px',
}
```

---

## Layout Architecture

### App Shell

```
┌─────────────────────────────────────────────┐
│  Header (56px)                              │
│  ┌─────────────────────────────────────┐  │
│  │ Logo | Breadcrumb | Search | Actions│  │
│  └─────────────────────────────────────┘  │
├─────────────────────────────────────────────┤
│  Main (flex-1, overflow-y-auto)            │
│  ┌─────────────┬─────────────────────────┐│
│  │ Sidebar     │                         ││
│  │ (256px)     │   Page Content         ││
│  │             │                         ││
│  └─────────────┴─────────────────────────┘│
└─────────────────────────────────────────────┘
```

**Mobile:** Sidebar hidden, hamburger menu toggles overlay.

### Sidebar Component

```tsx
interface SidebarItem {
  id: string;
  label: string;
  icon: React.ComponentType;
  href: string;
  badge?: number;
}

const navItems: SidebarItem[] = [
  { id: 'generate', label: 'Tạo văn bản', icon: FileTextIcon, href: '/generate' },
  { id: 'documents', label: 'Tài liệu', icon: FolderIcon, href: '/documents' },
  { id: 'qa', label: 'Tra cứu', icon: MessageSquareIcon, href: '/qa' },
  { id: 'admin', label: 'Quản trị', icon: ShieldIcon, href: '/admin/login' },
];
```

**States:**
- Expanded (default desktop): 256px width, labels visible
- Collapsed (tablet): 64px width, tooltips on hover
- Mobile (hidden): off-canvas drawer with overlay

---

## Page Specifications

### 1. Layout Page (`app/layout.tsx`)

**Add:**
- ThemeProvider (custom hook, localStorage)
- AnalyticsProvider (client-side event queue)
- Sidebar component
- Header component
- Toast provider (Radix Toast)

**Structure:**

```tsx
<html lang="vi" data-theme={theme}>
  <body className="bg-bg-primary text-text-primary">
    <ThemeProvider>
      <AnalyticsProvider>
        <Sidebar />
        <div className="h-screen flex flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
        <ToastProvider />
      </AnalyticsProvider>
    </ThemeProvider>
  </body>
</html>
```

---

### 2. Generate Page (`app/generate/page.tsx`)

**Layout:** 3-column grid on desktop, stacked on mobile.

```tsx
<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
  {/* Left Panel - Controls */}
  <div className="lg:col-span-3 space-y-4">
    <DocumentTypeSelector />
    <TemplateGallery />           {/* NEW */}
    <PDFUpload />
    <FieldExtractionForm />
    <GenerateButton />
    {isComplete && (
      <>
        <ValidateButton />
        <ExportDocxButton />
      </>
    )}
  </div>

  {/* Center - Editor */}
  <div className="lg:col-span-6">
    <StreamingDocumentEditor
      floatingToolbar={true}     // NEW
      showAcceptReject={true}    // NEW
    />
  </div>

  {/* Right - Context */}
  <div className="lg:col-span-3 space-y-4">
    <SourcePanel />              // Shows RAG chunks
    <ValidationPanel />          // Accordion checklist
    <FeedbackPanel />            // Edit diffs
  </div>
</div>
```

**Mobile:** Order: Editor top, Controls middle, Context bottom. Sticky footer with Accept/Reject when complete.

---

### 3. Q&A Page (`app/qa/page.tsx`)

**Layout:** Chat interface

```tsx
<div className="flex flex-col h-[calc(100vh-56px)]">
  {/* Header */}
  <header className="border-b px-4 py-3">
    <h1>Tra cứu văn bản</h1>
    <DocTypeFilter />
  </header>

  {/* Messages */}
  <div className="flex-1 overflow-y-auto p-4 space-y-4">
    {messages.map(msg => (
      <MessageBubble key={idx} message={msg} />
    ))}
    {isAsking && <TypingIndicator />}
    <div ref={bottomRef} />
  </div>

  {/* Input */}
  <form onSubmit={handleSubmit} className="border-t p-4">
    <div className="flex gap-2">
      <Textarea
        value={question}
        onChange={e => setQuestion(e.target.value)}
        placeholder="Nhập câu hỏi..."
        autoResize
      />
      <Button type="submit" disabled={isAsking}>
        <SendIcon />
      </Button>
    </div>
  </form>
</div>
```

**MessageBubble:**
- User: blue bubble, right-aligned
- Assistant: white/gray-100, left-aligned
- Sources: collapsible card stack with article/clause labels
- Citations: inline `[1]` links that scroll to source

---

### 4. Documents Page

**TODO:** Review current implementation; likely needs:
- Table/list of uploaded documents with search/filter
- Thumbnail previews
- Bulk actions (delete, tag)
- Upload zone at top

---

### 5. Template Gallery Component

```tsx
interface Template {
  id: string;
  name: string;
  description: string;
  documentType: string;
  previewImage?: string; // placeholder SVG if none
  fields: TemplateField[];
}

const TemplateGallery = ({ onSelect }: { onSelect: (t: Template) => void }) => {
  const [templates] = useTemplates(); // fetch from /api/templates

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-sm text-text-secondary">
        Mẫu văn bản
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map(t => (
          <Card
            key={t.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onSelect(t)}
          >
            <div className="h-24 bg-bg-tertiary rounded-t-lg flex items-center justify-center">
              {t.previewImage ? (
                <img src={t.previewImage} alt="" className="w-full h-full object-cover rounded-t-lg" />
              ) : (
                <FileTextIcon className="w-10 h-10 text-text-tertiary" />
              )}
            </div>
            <div className="p-3">
              <h4 className="font-medium text-sm">{t.name}</h4>
              <p className="text-xs text-text-secondary mt-1 line-clamp-2">
                {t.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {t.fields.slice(0, 3).map(f => (
                  <span key={f.name} className="px-1.5 py-0.5 bg-bg-tertiary text-xs rounded">
                    {f.label}
                  </span>
                ))}
                {t.fields.length > 3 && (
                  <span className="px-1.5 py-0.5 text-xs text-text-secondary">
                    +{t.fields.length - 3} more
                  </span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};
```

---

## Component Library (Radix UI + Tailwind)

### Base Components

All components accept `className` prop for customization.

**Button:**

```tsx
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

const Button = ({ variant = 'primary', size = 'md', isLoading, children, className, ...props }: ButtonProps) => {
  const base = 'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-accent-primary text-white hover:bg-accent-hover focus:ring-accent-primary',
    secondary: 'bg-bg-tertiary text-text-primary hover:bg-border focus:ring-text-primary',
    ghost: 'text-text-primary hover:bg-bg-tertiary focus:ring-text-primary',
    destructive: 'bg-error text-white hover:bg-red-700 focus:ring-error',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };

  return (
    <button className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {isLoading && <Spinner className="mr-2" />}
      {children}
    </button>
  );
};
```

**Card:**

```tsx
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outlined';
}

const Card = ({ variant = 'default', className, ...props }: CardProps) => {
  const base = 'rounded-lg bg-bg-primary border';
  const variants = {
    default: 'border-border shadow-sm',
    elevated: 'border-transparent shadow-md',
    outlined: 'border-border shadow-none',
  };

  return <div className={cn(base, variants[variant], className)} {...props} />;
};
```

**Select (Radix):**

```tsx
const Select = ({ value, onValueChange, placeholder, items }: SelectProps) => (
  <Select.Root value={value} onValueChange={onValueChange}>
    <Select.Trigger className="w-full px-3 py-2 border border-border rounded-md bg-bg-primary">
      <Select.Value placeholder={placeholder} />
      <ChevronDownIcon className="ml-auto h-4 w-4" />
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="bg-bg-primary border border-border rounded-md shadow-lg z-50">
        <Select.Viewport>
          {items.map(item => (
            <Select.Item key={item.value} value={item.value} className="px-3 py-2 hover:bg-bg-tertiary">
              <Select.ItemText>{item.label}</Select.ItemText>
            </Select.Item>
          ))}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
);
```

**Toast (Radix):**

```tsx
const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => removeToast(id), toast.duration || 5000);
  };

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <Toast.Viewport className="fixed top-4 right-4 z-50 flex flex-col gap-2" />
      {toasts.map(t => (
        <Toast.Root key={t.id} className={cn('px-4 py-3 rounded-lg shadow-lg', {
          'bg-success text-white': t.variant === 'success',
          'bg-error text-white': t.variant === 'error',
          'bg-bg-primary border border-border': t.variant === 'info',
        })}>
          <Toast.Title>{t.title}</Toast.Title>
          {t.description && <Toast.Description>{t.description}</Toast.Description>}
          <Toast.Close className="absolute top-2 right-2">×</Toast.Close>
        </Toast.Root>
      ))}
    </Toast.Context.Provider>
  );
};
```

---

## Accessibility Requirements

1. **Radix UI Primitives:** All interactive components use Radix (Select, Dialog, Toast, DropdownMenu, Tabs) — guarantees keyboard nav and ARIA.
2. **Focus Visible:** `focus:ring-2 focus:ring-accent-primary focus:ring-offset-2` on all interactive elements; `:focus-visible` only (not on mouse click).
3. **Skip Links:** Two skip links at top of page:
   - "Skip to main content" → `<main id="main">`
   - "Skip to navigation" → `<nav id="sidebar">`
4. **Color Contrast:** All text meets 4.5:1 ratio (large text 3:1). Verify with Lighthouse.
5. **Heading Hierarchy:** Single `<h1>` per page; sections use `<h2>`-`<h6>` without skipping levels.
6. **Alt Text:** Decorative images get empty `alt=""`; meaningful images get descriptive alt.
7. **Form Labels:** All inputs have associated `<label>` or `aria-label`.
8. **Live Regions:** Streaming content updates have `aria-live="polite"`; errors use `assertive`.
9. **Focus Trap:** Modals/drawers trap focus; close on `Esc`.
10. **Reduced Motion:** `@media (prefers-reduced-motion: reduce)` — disable non-essential animations.

---

## Dark Mode Implementation

**Theme Hook:**

```tsx
// lib/theme.ts
const themes = ['light', 'dark'] as const;
type Theme = typeof themes[number];

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('theme') as Theme | null;
    if (stored && themes.includes(stored)) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  return { theme, toggle };
}
```

**Toggle Button in Header:**

```tsx
<Button variant="ghost" size="sm" onClick={toggleTheme} aria-label="Toggle dark mode">
  {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
</Button>
```

---

## Analytics Tracking

**Client library:**

```tsx
// lib/analytics.ts
interface Event {
  name: string;
  properties?: Record<string, any>;
}

const queue: Event[] = [];
let flushTimer: NodeJS.Timeout | null = null;

export function track(name: string, properties?: Record<string, any>) {
  queue.push({ name, properties });
  // Debounce flush to avoid spam
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 1000);
}

async function flush() {
  if (queue.length === 0) return;
  try {
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: queue.splice(0) }),
    });
  } catch {
    // Queue events locally for retry
    localStorage.setItem('analytics_queue', JSON.stringify(queue));
  }
}

// Replay queued events on page load
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('analytics_queue');
  if (saved) {
    try {
      const events = JSON.parse(saved);
      events.forEach(e => track(e.name, e.properties));
    } catch {}
  }
}
```

**Events to track:**
- `page_view: { path, title }`
- `click: { element, label }` (on important buttons)
- `generation:start: { docType, hasPdf }`
- `generation:complete: { durationMs, tokenCount? }`
- `generation:error: { errorType }`
- `template:select: { templateId, templateName }`
- `export:docx: { success }`
- `validation:run: { valid, missingCount, warningCount }`

---

## Implementation Phases

### Phase 1: Design System Foundation (Week 1)
- Set up CSS variables, Tailwind config extension
- Create `components/ui/*` (Button, Card, Input, Textarea, Select, Badge, Switch, Skeleton)
- Create `hooks/useTheme.ts`
- Create `components/layout/Sidebar.tsx` and `Header.tsx`
- Create `components/layout/AppShell.tsx` wrapper
- **Deliverable:** All pages use new sidebar + header; light theme only.

### Phase 2: Generate Page Redesign (Week 2)
- Build `TemplateGallery` component
- Add floating toolbar to `StreamingDocumentEditor`
- Add SourcePanel and ValidationPanel components
- Implement responsive grid (1→2→3 columns)
- **Deliverable:** Generate page fully functional in new layout.

### Phase 3: Q&A Page Redesign (Week 3)
- Redesign chat UI with message bubbles
- Add source cards (expandable)
- Add copy/regenerate buttons
- Improve error handling (toast + inline)
- **Deliverable:** Q&A page matches new design system.

### Phase 4: Accessibility & Dark Mode (Week 4)
- Implement dark theme toggle + persistence
- Add skip links, focus visible outlines
- Full keyboard navigation test
- Color contrast audit (Lighthouse)
- Screen reader testing (VoiceOver/NVDA)
- **Deliverable:** WCAG 2.1 AA compliance report.

### Phase 5: Polish & Analytics (Week 5)
- Add analytics tracking to key interactions
- Performance optimization (code splitting, lazy load)
- Error boundaries for graceful failures
- Loading skeletons for all async states
- **Deliverable:** Production-ready frontend, deployment guide.

---

## API Changes Needed

**New endpoint:** `POST /api/analytics/track`

```ts
// backend/src/routes/analytics.ts (new)
interface TrackRequest {
  events: Array<{ name: string; properties?: Record<string, any> }>;
}
// Simple in-memory store or Redis; no auth for now (internal only)
```

**Optional:** `GET /api/templates` for Template Gallery (if not already present).

---

## Success Criteria

- [ ] All pages use new design system (consistent spacing, colors, typography)
- [ ] Mobile responsive (tested at 375px, 768px, 1024px)
- [ ] Dark mode toggle works, preference persisted
- [ ] Template Gallery implemented and functional
- [ ] WCAG 2.1 AA compliance (Lighthouse score > 90 on accessibility)
- [ ] No console errors/warnings in production build
- [ ] Page load < 3s on 3G (Lighthouse Performance > 70)
- [ ] Analytics events firing correctly

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Monaco editor integration breaks with floating toolbar | High | Test thoroughly; fallback to fixed toolbar if needed |
| Radix UI bundle size increase | Medium | Tree-shake unused primitives; measure with `@next/bundle-analyzer` |
| Dark mode CSS variable coverage gaps | Medium | Audit all components; add fallback values |
| Mobile layout complexity | Medium | Start with breakpoints; test on real devices early |
| Analytics endpoint spam | Low | Rate limit; debounce client-side |

---

## Appendix: Component Checklist

- [x] Button (variants: primary/secondary/ghost/destructive; sizes: sm/md/lg)
- [ ] Input (with label, error state, helper text)
- [ ] Textarea (auto-resize)
- [ ] Select (Radix)
- [ ] Card (variants)
- [ ] Badge (status colors)
- [ ] Switch (dark mode toggle)
- [ ] Toast (Radix provider + component)
- [ ] Skeleton (loading placeholder)
- [ ] Dialog (Radix)
- [ ] DropdownMenu (Radix)
- [ ] Tabs (Radix)
- [ ] Separator
- [ ] Icon components (lucide-react wrappers with consistent sizing)

---

## Appendix: Color Usage Examples

```tsx
// Page background
className="bg-bg-primary"

// Card
className="bg-bg-primary border border-border shadow-sm"

// Primary button
className="bg-accent-primary text-white hover:bg-accent-hover"

// Secondary button
className="bg-bg-tertiary text-text-primary hover:bg-border"

// Error text
className="text-error"

// Success badge
<Badge variant="success">Thành công</Badge>

// Input focus
className="focus:ring-2 focus:ring-accent-primary focus:border-transparent"
```

---

## Migration Plan (Existing → New)

1. **Do not break existing routes** — implement alongside, then switch over.
2. Create `app/(new)/` parallel structure, copy pages gradually.
3. Keep old pages working until all new pages verified.
4. Update navigation links to new routes incrementally.
5. Final cutover: rename `(new)` → `app/` and delete old files.

---

**Next step:** Write implementation plan using `superpowers:writing-plans` after spec approval.
