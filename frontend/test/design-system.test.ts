import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

const readUiSources = (directory: string): string =>
  readdirSync(resolve(process.cwd(), directory), { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return readUiSources(child);
      return /\.(tsx|css)$/.test(entry.name) ? [readProjectFile(child)] : [];
    })
    .join('\n');

/** Component markup only. Excludes `globals.css`, which defines the raw tokens. */
const readComponentSources = (directory: string): string =>
  readdirSync(resolve(process.cwd(), directory), { withFileTypes: true })
    .flatMap((entry) => {
      const child = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return readComponentSources(child);
      return /\.tsx$/.test(entry.name) ? [readProjectFile(child)] : [];
    })
    .join('\n');

describe('rounded civic workspace design contract', () => {
  it('loads only Be Vietnam Pro and JetBrains Mono', () => {
    const layout = readProjectFile('app/layout.tsx');

    expect(layout).toContain('Be_Vietnam_Pro');
    expect(layout).toContain('JetBrains_Mono');
    expect(layout).not.toMatch(/Inter|Plus_Jakarta_Sans|Playfair_Display/);
  });

  it('removes legacy local font faces from global CSS', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).not.toMatch(/Google Sans Flex|Google Sans Code|Google Symbols/);
    expect(css).not.toContain('@font-face');
  });

  it('defines the rounded civic radius scale', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).toContain('--radius-workspace: 24px');
    expect(css).toContain('--radius-panel: 16px');
    expect(css).toContain('--radius-control: 12px');
    expect(css).toContain('--radius-compact: 10px');
    expect(css).toContain('--radius-pill: 9999px');
  });

  it('makes light mode the root default and dark an override', () => {
    const css = readProjectFile('app/globals.css');
    const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="dark"]'));

    expect(rootBlock).toContain('color-scheme: light');
    expect(rootBlock).toContain('--color-canvas: #EEF1F5');
    expect(rootBlock).toContain('--color-workspace: #FFFFFF');
    expect(rootBlock).toContain('--color-action: #3157D5');
    expect(css).toMatch(/\[data-theme="dark"\]\s*\{[\s\S]*--color-canvas: #111318/);
  });

  it('sets the body typography contract', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).toContain('font-synthesis: none');
    expect(css).toMatch(/body\s*\{[\s\S]*font-family: var\(--font-text\)/);
    expect(css).toMatch(/body\s*\{[\s\S]*font-size: 16px/);
  });

  it('tokenizes the focus ring instead of a raw blue shadow', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).toContain('--color-focus-ring');
    expect(css).not.toContain('rgba(26, 115, 232, 0.2)');
  });

  it('declares the named type scale in Tailwind', () => {
    const config = readProjectFile('tailwind.config.js');

    expect(config).toContain("'page-title'");
    expect(config).toContain("'section-title'");
    expect(config).toContain("'metadata'");
    expect(config).toContain("'control'");
    expect(config).toContain("'technical'");
  });

  it('maps Tailwind radii to the semantic radius tokens', () => {
    const config = readProjectFile('tailwind.config.js');

    expect(config).toContain("workspace: 'var(--radius-workspace)'");
    expect(config).toContain("panel: 'var(--radius-panel)'");
    expect(config).toContain("control: 'var(--radius-control)'");
    expect(config).toContain("compact: 'var(--radius-compact)'");
    expect(config).toContain("pill: 'var(--radius-pill)'");
  });

  it('keeps semantic Tailwind color aliases', () => {
    const config = readProjectFile('tailwind.config.js');

    expect(config).toContain("canvas: 'var(--color-canvas)'");
    expect(config).toContain("workspace: 'var(--color-workspace)'");
    expect(config).toContain("action: 'var(--color-action)'");
    expect(config).toContain("hairline: 'var(--color-hairline)'");
  });

  it('keeps portalled controls above modal content and below notifications', () => {
    const css = readProjectFile('app/globals.css');
    const config = readProjectFile('tailwind.config.js');
    const selectSource = readProjectFile('components/ui/select.tsx');

    expect(css).toContain('--z-popover: 1050');
    expect(config).toContain("popover: 'var(--z-popover)'");
    expect(selectSource).toContain('z-popover');
  });

  it('reserves semantic inline space for leading field icons', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).toMatch(/\.control-field-leading-icon\s*\{[^}]*padding-inline-start:\s*40px/s);
  });

  it('removes legacy decorative APIs from the complete UI source', () => {
    const source = `${readUiSources('app')}\n${readUiSources('components')}\n${readProjectFile('tailwind.config.js')}`;

    expect(source).not.toMatch(
      /glass-|bg-void|bg-glass|shadow-glow|purple-|indigo-|bg-gradient|bg-clip-text|bg-grid-pattern|floatOrb|animate-float|glow-border|backdrop-filter|backdrop-blur/,
    );
  });

  it('has no raw shadow values, tiny UI text, or obsolete type utilities in the UI source', () => {
    const source = `${readUiSources('app')}\n${readUiSources('components')}`;

    expect(source).not.toMatch(/shadow-\[[^\]]*rgba/);
    expect(source).not.toMatch(/text-\[(?:[0-9]|1[0-2])px\]/);
    expect(source).not.toMatch(/text-display-xl|text-product-title|text-nav\b/);
  });

  it('uses only the named type scale across every route and component', () => {
    const source = `${readUiSources('app')}\n${readUiSources('components')}`;

    // Arbitrary Tailwind text sizes drift off the documented ramp.
    expect(source).not.toMatch(
      /className="[^"]*\btext-(?:xs|sm|base|lg|xl|2xl|caption|heading-1|heading-2|code)\b/,
    );
  });

  it('uses only the semantic radius scale', () => {
    const source = `${readUiSources('app')}\n${readUiSources('components')}`;

    expect(source).not.toMatch(
      /className="[^"]*\brounded-(?:sm|md|lg|xl|2xl|3xl|full|none|card|dialog)\b/,
    );
  });

  it('keeps every colour on a semantic token', () => {
    // Markup only: `app/globals.css` is where the raw token values are defined.
    const source = `${readComponentSources('app')}\n${readComponentSources('components')}`;

    // `text-tertiary` was never defined, so it silently rendered no colour.
    expect(source).not.toMatch(/text-text-tertiary|bg-text-tertiary/);
    expect(source).not.toMatch(/\b(?:text|bg)-white\b/);
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  it('keeps deprecated migration aliases out of the token contract', () => {
    const config = readProjectFile('tailwind.config.js');

    for (const alias of [
      "card: 'var(--radius-control)'",
      "dialog: 'var(--radius-panel)'",
      'flat:',
      'raised:',
      "'canvas-subtle'",
      "'surface-raised'",
      "'heading-2'",
      'caption:',
    ]) {
      expect(config).not.toContain(alias);
    }
  });

  it('keeps accessible names in Vietnamese', () => {
    const source = `${readUiSources('app')}\n${readUiSources('components')}`;
    const englishOnly = /aria-label="(Close|Open|Save|Delete|Cancel|Submit|Search|Remove [a-z]+|Show [a-z]+|Hide [a-z]+|Toggle [a-z]+|Switch to [a-z ]+)"/;

    expect(source).not.toMatch(englishOnly);
  });

  it('defines the Elevated Civic motion token layer', () => {
    const css = readProjectFile('app/globals.css');

    expect(css).toContain('--duration-fast: 150ms');
    expect(css).toContain('--duration-standard: 200ms');
    expect(css).toContain('--duration-emphasized: 480ms');
    expect(css).toContain('--ease-out: cubic-bezier(0.22, 0.61, 0.36, 1)');
    expect(css).toContain('--ease-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1)');
    expect(css).toContain('--ease-spring: cubic-bezier(0.22, 1, 0.36, 1)');
  });

  it('maps the emphasized duration and spring easings into Tailwind', () => {
    const config = readProjectFile('tailwind.config.js');

    expect(config).toContain("emphasized: 'var(--duration-emphasized)'");
    expect(config).toContain("decelerate: 'var(--ease-decelerate)'");
    expect(config).toContain("spring: 'var(--ease-spring)'");
  });

  it('defines the landing display ramp', () => {
    const config = readProjectFile('tailwind.config.js');

    expect(config).toContain("'display-hero'");
    expect(config).toContain("'display-lg'");
    expect(config).toContain("'display-md'");
  });

  it('keeps shared choreography presets in one library', () => {
    const presets = readProjectFile('lib/motion.ts');

    expect(presets).toContain("from 'motion/react'");
    expect(presets).toContain('export const springSnappy');
    expect(presets).toContain('export const springSoft');
    expect(presets).toContain('export const fadeRise');
    expect(presets).toContain('export const maskLine');
  });

  it('gates every animation behind the user reduced-motion preference', () => {
    const provider = readProjectFile('components/providers/MotionProvider.tsx');
    const layout = readProjectFile('app/layout.tsx');

    expect(provider).toContain('reducedMotion="user"');
    expect(layout).toContain('MotionProvider');
  });

  it('keeps the design contract document aligned with the approved specification', () => {
    const design = readProjectFile('DESIGN.md');

    expect(design).toContain('Rounded Civic Workspace');
    expect(design).toContain('2026-08-08-rounded-civic-workspace-design.md');
    expect(design).toMatch(/Be Vietnam Pro/);

    // Legacy directions may only be named where they are explicitly superseded,
    // never as normative guidance.
    const supersession = design.slice(design.indexOf('supersedes'));
    const normative = design.replace(supersession, '');
    expect(normative).not.toMatch(/antigravity|Apple-inspired|SF Pro/i);
    expect(design).not.toMatch(/Google Sans|Plus Jakarta|Playfair/i);
  });
});
