# TypeScript 7 Project-Green Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ops/verify-all.ps1` pass while TypeScript 7 is the only installed TypeScript compiler in the backend and frontend.

**Architecture:** TypeScript 7 performs all static checking and backend emission. API-independent tools erase TypeScript syntax for Jest, Vitest, development startup, and ESLint; the frontend package script runs TypeScript 7 before allowing Next.js to build with its incompatible internal checker disabled.

**Tech Stack:** TypeScript 7.0.2, Node.js, npm, Express, Jest 29 with Babel 7, Next.js 16.2, React 19, ESLint 9 with Babel parser, Vitest 4, PowerShell/Pester.

## Global Constraints

- TypeScript 7 must be the only installed TypeScript compiler.
- Do not install TypeScript 6, `@typescript/typescript6`, or a TypeScript 6 npm alias.
- Do not use `ts-node`, `ts-node-dev`, `ts-jest`, or `typescript-eslint`.
- Do not relax TypeScript compiler options or skip/delete tests to make checks pass.
- Preserve all unrelated user changes in the existing dirty worktree.
- Do not make implementation commits that would capture pre-existing user changes; use the saved plan and verification output as checkpoints.
- Unit and contract tests must not require live PostgreSQL, Redis, renderer, embeddings, or LLM services.
- A Next.js `ignoreBuildErrors` setting is valid only when `npm run build` first runs the explicit TypeScript 7 `typecheck` script.

---

### Task 1: Add a TypeScript 7 Toolchain Contract

**Files:**
- Create: `ops/tests/TypeScript7.Tests.ps1`

**Interfaces:**
- Consumes: `backend/package.json`, `frontend/package.json`, `frontend/next.config.js`, and `frontend/eslint.config.mjs`.
- Produces: a Pester contract that prevents TypeScript 6/API-dependent tooling from returning.

- [ ] **Step 1: Add the failing repository contract**

```powershell
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path

Describe 'strict TypeScript 7 toolchain' {
  BeforeAll {
    $backend = Get-Content -LiteralPath (Join-Path $root 'backend/package.json') -Raw | ConvertFrom-Json
    $frontend = Get-Content -LiteralPath (Join-Path $root 'frontend/package.json') -Raw | ConvertFrom-Json
    $nextConfig = Get-Content -LiteralPath (Join-Path $root 'frontend/next.config.js') -Raw
    $eslintConfig = Get-Content -LiteralPath (Join-Path $root 'frontend/eslint.config.mjs') -Raw
  }

  It 'uses TypeScript 7 and API-independent backend development tooling' {
    $backend.devDependencies.typescript | Should Match '^\^?7\.'
    $backend.scripts.dev | Should Be 'tsx watch src/index.ts'
    $backend.devDependencies.PSObject.Properties.Name | Should Not Contain 'ts-node-dev'
    $backend.devDependencies.PSObject.Properties.Name | Should Not Contain 'ts-jest'
  }

  It 'runs the TypeScript 7 frontend check before Next build' {
    $frontend.devDependencies.typescript | Should Match '^\^?7\.'
    $frontend.scripts.typecheck | Should Be 'tsc --noEmit'
    $frontend.scripts.build | Should Be 'npm run typecheck && next build'
    $nextConfig | Should Match 'ignoreBuildErrors:\s*true'
  }

  It 'does not load TypeScript compiler-API lint tooling' {
    $frontend.devDependencies.PSObject.Properties.Name | Should Not Contain 'eslint-config-next'
    $eslintConfig | Should Not Match 'eslint-config-next|typescript-eslint'
    $eslintConfig | Should Match '@babel/eslint-parser'
    $eslintConfig | Should Match '@next/eslint-plugin-next'
  }

  It 'contains no TypeScript 6 compatibility dependency' {
    foreach ($path in @('backend/package.json', 'backend/package-lock.json', 'frontend/package.json', 'frontend/package-lock.json')) {
      $content = Get-Content -LiteralPath (Join-Path $root $path) -Raw
      $content | Should Not Match '@typescript/typescript6|typescript6@|typescript@npm:@typescript/typescript6'
    }
  }
}
```

- [ ] **Step 2: Run the contract and verify it fails for the current toolchain**

Run:

```powershell
Invoke-Pester .\ops\tests\TypeScript7.Tests.ps1 -PassThru
```

Expected: failures identify `ts-node-dev`, the missing frontend `typecheck` gate, `eslint-config-next`, and the absent Next.js bypass.

- [ ] **Step 3: Record the red result**

Keep the Pester output as the Task 2 acceptance baseline. Do not change the assertions to fit the current packages.

---

### Task 2: Replace TypeScript API-Dependent Tooling

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`
- Modify: `backend/jest.config.js`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/eslint.config.mjs`
- Modify: `frontend/next.config.js`
- Test: `ops/tests/TypeScript7.Tests.ps1`

**Interfaces:**
- Consumes: the contract from Task 1.
- Produces: `npm run dev` through `tsx`, Jest through Babel, `npm run typecheck` through TypeScript 7, and ESLint without `typescript-eslint`.

- [ ] **Step 1: Switch backend development and Jest transforms**

Set the backend scripts and dependencies to:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc"
  },
  "devDependencies": {
    "@babel/core": "^7.29.7",
    "@babel/preset-env": "^7.29.7",
    "@babel/preset-typescript": "^7.29.7",
    "babel-jest": "^29.7.0",
    "tsx": "^4.23.0",
    "typescript": "^7.0.0"
  }
}
```

Preserve all other existing package entries. Remove `@swc/core`, `@swc/jest`, and `ts-node-dev`.

Replace the Jest transform with:

```javascript
module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/src/test/jest.setup.ts'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
```

- [ ] **Step 2: Add the guarded frontend build scripts**

Preserve all unrelated dependencies and scripts, then set:

```json
{
  "scripts": {
    "build": "npm run typecheck && next build",
    "typecheck": "tsc --noEmit"
  }
}
```

Remove `eslint-config-next`. Add these direct development dependencies:

```json
{
  "@babel/core": "^7.29.7",
  "@babel/eslint-parser": "^7.29.7",
  "@babel/preset-react": "^7.29.7",
  "@babel/preset-typescript": "^7.29.7",
  "@next/eslint-plugin-next": "16.2.10",
  "eslint-import-resolver-typescript": "^3.10.1",
  "eslint-plugin-import": "^2.32.0",
  "eslint-plugin-jsx-a11y": "^6.10.2",
  "eslint-plugin-react": "^7.37.5",
  "eslint-plugin-react-hooks": "^7.1.1",
  "globals": "^17.7.0"
}
```

- [ ] **Step 3: Configure API-independent frontend linting**

Replace `frontend/eslint.config.mjs` with:

```javascript
import babelParser from '@babel/eslint-parser';
import nextPlugin from '@next/eslint-plugin-next';
import importPlugin from 'eslint-plugin-import';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        sourceType: 'module',
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: [
            ['@babel/preset-react', { runtime: 'automatic' }],
            '@babel/preset-typescript',
          ],
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@next/next': nextPlugin,
      import: importPlugin,
      'jsx-a11y': jsxA11y,
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
      'import/resolver': {
        typescript: { project: './tsconfig.json' },
      },
    },
    rules: {
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...importPlugin.flatConfigs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'import/no-unresolved': 'off',
      'react/prop-types': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['.next/**', 'coverage/**', 'dist/**', 'next-env.d.ts']),
]);
```

- [ ] **Step 4: Pair the Next.js bypass with the prebuild gate**

Set:

```javascript
module.exports = {
  reactStrictMode: true,
  typescript: {
    // TypeScript 7 has no JavaScript compiler API. `npm run build` runs
    // the native `tsc --noEmit` gate before invoking Next.js.
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: __dirname,
  },
};
```

- [ ] **Step 5: Regenerate both npm lockfiles**

Run:

```powershell
npm --prefix .\backend install
npm --prefix .\frontend install
```

Expected: both commands exit 0 and neither installs a TypeScript 6 compatibility package.

- [ ] **Step 6: Verify the toolchain contract turns green**

Run:

```powershell
Invoke-Pester .\ops\tests\TypeScript7.Tests.ps1 -PassThru
npm --prefix .\backend ls typescript ts-node ts-node-dev --depth=2
npm --prefix .\frontend ls typescript typescript-eslint eslint-config-next --depth=2
npm --prefix .\backend exec -- tsc --version
npm --prefix .\frontend exec -- tsc --version
```

Expected: Pester passes; both compilers report 7.x; the removed API-dependent packages are absent without invalid peer dependencies.

---

### Task 3: Repair the Frontend Proxy Route

**Files:**
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Test: `frontend/test/security-routes.test.ts`

**Interfaces:**
- Consumes: `NextRequest`, `NextResponse`, `BACKEND_API_URL`, and the `docai_session` cookie.
- Produces: forwarding to `${BACKEND_URL}/api/${pathSegments}${search}` with a server-owned Bearer header and filtered identity headers.

- [ ] **Step 1: Confirm the proxy regression fails**

Run:

```powershell
npm --prefix .\frontend test -- --run test/security-routes.test.ts
```

Expected: parsing fails at the malformed `target` expression.

- [ ] **Step 2: Restore the three malformed expressions**

Use:

```typescript
const target = `${BACKEND_URL}/api/${pathSegments}${search}`;
```

```typescript
forwardedHeaders.set('Authorization', `Bearer ${sessionToken}`);
```

```typescript
console.error(`[proxy] Backend unreachable at ${target}:`, message);
```

- [ ] **Step 3: Verify proxy behavior**

Run:

```powershell
npm --prefix .\frontend test -- --run test/security-routes.test.ts
npm --prefix .\frontend run typecheck
```

Expected: the route security test passes and TypeScript advances beyond the proxy syntax errors.

---

### Task 4: Repair Backend Test Isolation and Authentication

**Files:**
- Modify: `backend/src/services/template_storage_service.ts`
- Modify: `backend/src/middleware/user_auth.ts`
- Test: `backend/src/routes/auth.contract.test.ts`
- Test: `backend/src/scripts/backfill_embeddings.test.ts`
- Test: `backend/src/services/template_storage_service.test.ts`
- Test: `backend/src/middleware/user_auth_security.test.ts`

**Interfaces:**
- Consumes: Babel-Jest mock hoisting from Task 2.
- Produces: hermetic Prisma mocks, runtime-resolved template storage, and `optionalUserAuthMiddleware(req, res, next): Promise<void>`.

- [ ] **Step 1: Verify Babel-Jest fixes hoisted Prisma mocks**

Run:

```powershell
npm --prefix .\backend test -- --runInBand src/routes/auth.contract.test.ts src/scripts/backfill_embeddings.test.ts
```

Expected: both suites use their declared mocks and make no live database connection. If a mock still fails, move the tested module import below the `jest.mock` declarations using CommonJS `require` without changing production behavior.

- [ ] **Step 2: Confirm dynamic storage-root behavior is red**

Run:

```powershell
npm --prefix .\backend test -- --runInBand src/services/template_storage_service.test.ts
```

Expected: disk assertions fail because the module-level `TEMPLATE_STORAGE_DIR` was captured before the test environment override executed.

- [ ] **Step 3: Resolve the template storage directory at call time**

Replace the module-level value with:

```typescript
function getTemplateStorageDir(): string {
  return process.env.TEMPLATE_STORAGE_DIR || resolve(__dirname, '../../uploads/templates');
}
```

Use `getTemplateStorageDir()` wherever the implementation constructs original,
preview, staged-deletion, or generated-document paths. Use `resolve`/`join`
instead of hard-coded separators for filesystem paths; keep stored database keys
as forward-slash relative paths.

- [ ] **Step 4: Verify storage behavior**

Run:

```powershell
npm --prefix .\backend test -- --runInBand src/services/template_storage_service.test.ts
```

Expected: all storage tests pass on Windows, including hash verification and deletion rollback.

- [ ] **Step 5: Confirm the optional authentication contract is red**

Run:

```powershell
npm --prefix .\backend test -- --runInBand src/middleware/user_auth_security.test.ts
```

Expected: optional-session cases fail because `optionalUserAuthMiddleware` is not exported.

- [ ] **Step 6: Implement the optional authentication middleware**

Add:

```typescript
export async function optionalUserAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined) {
    next();
    return;
  }
  if (!authHeader.startsWith('Bearer ') || authHeader.slice(7).trim() === '') {
    res.status(401).json({ error: 'Missing or invalid authorization token' });
    return;
  }

  try {
    req.user = await verifyUserToken(authHeader.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```

- [ ] **Step 7: Verify the repaired backend slice**

Run:

```powershell
npm --prefix .\backend test -- --runInBand src/routes/auth.contract.test.ts src/scripts/backfill_embeddings.test.ts src/services/template_storage_service.test.ts src/middleware/user_auth_security.test.ts
npm --prefix .\backend run build
```

Expected: all named suites and the TypeScript 7 backend build pass.

---

### Task 5: Restore the Frontend Design Contract

**Files:**
- Modify: `frontend/app/(app)/generate/page.tsx`
- Test: `frontend/test/design-system.test.ts`

**Interfaces:**
- Consumes: semantic Tailwind aliases from `frontend/tailwind.config.js`.
- Produces: the generate page using `bg-canvas`, `bg-surface`, `border-hairline`, `rounded-control`, and `rounded-card` without legacy glass/void APIs.

- [ ] **Step 1: Confirm the design contract is red**

Run:

```powershell
npm --prefix .\frontend test -- --run test/design-system.test.ts
```

Expected: the legacy decorative API assertion reports `bg-void`, `glass-*`, or `bg-bg-glass` usages in the generate page.

- [ ] **Step 2: Replace legacy classes with semantic tokens**

Apply these mappings only in `generate/page.tsx`:

```text
bg-void                         -> bg-canvas
border-border-glass             -> border-hairline
bg-bg-glass                     -> bg-surface
hover:bg-bg-glass-hover         -> hover:bg-canvas-subtle
hover:border-border-glass-hover -> hover:border-action/40
glass-panel                     -> rounded-card bg-surface
```

Replace each `glass-input` occurrence with explicit semantic input classes:

```text
rounded-control border border-hairline bg-surface px-4 py-2 text-text-primary outline-none transition-colors focus:border-action
```

- [ ] **Step 3: Verify design and affected page tests**

Run:

```powershell
npm --prefix .\frontend test -- --run test/design-system.test.ts test/templates-page.test.tsx
```

Expected: both suites pass without weakening the legacy-API regex.

---

### Task 6: Make Node Application Verification Green

**Files:**
- Modify only files directly identified by a reproducible failing test, lint diagnostic, or TypeScript diagnostic.
- Test: all backend Jest and frontend Vitest suites.

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: green backend/frontend test, lint, typecheck, and build commands.

- [ ] **Step 1: Run the complete backend gate**

Run:

```powershell
npm --prefix .\backend test -- --runInBand
npm --prefix .\backend exec -- prisma validate
npm --prefix .\backend run check-schema
npm --prefix .\backend run test:migrations
npm --prefix .\backend run build
```

Expected: all commands exit 0. For any newly exposed failure, capture the exact failing test, reproduce that test alone, identify whether the cause is transform order, test isolation, platform path handling, or production behavior, then add or retain a regression assertion before the smallest source correction.

- [ ] **Step 2: Run the complete frontend gate**

Run:

```powershell
npm --prefix .\frontend test -- --run
npm --prefix .\frontend run lint
npm --prefix .\frontend run typecheck
npm --prefix .\frontend run build
```

Expected: all commands exit 0 with zero lint warnings. Correct source diagnostics; do not disable additional rule families or relax compiler settings.

- [ ] **Step 3: Run dependency health checks**

Run:

```powershell
npm --prefix .\backend audit --audit-level=moderate
npm --prefix .\frontend audit --audit-level=moderate
npm --prefix .\backend ls --all
npm --prefix .\frontend ls --all
```

Expected: audit and dependency-tree checks exit 0.

---

### Task 7: Run Full Repository Verification

**Files:**
- Modify: `ops/verify-all.ps1` only if its command wiring, not the verified application, is the reproducible cause of a failure.
- Test: `ops/tests/TypeScript7.Tests.ps1`

**Interfaces:**
- Consumes: all earlier tasks and the repository's existing .NET, Python, Compose, and Pester verification steps.
- Produces: a single successful `ops/verify-all.ps1` run.

- [ ] **Step 1: Run operations contracts**

Run:

```powershell
Invoke-Pester .\ops\tests -PassThru
```

Expected: zero failed Pester tests, including the strict TypeScript 7 contract.

- [ ] **Step 2: Run the repository verifier**

Run:

```powershell
pwsh -NoProfile -File .\ops\verify-all.ps1
```

Expected final line:

```text
All verification steps passed.
```

- [ ] **Step 3: Verify the final diff and TypeScript proof**

Run:

```powershell
git diff --check
npm --prefix .\backend exec -- tsc --version
npm --prefix .\frontend exec -- tsc --version
rg -n '@typescript/typescript6|typescript6@|ts-node-dev|typescript-eslint' backend/package.json backend/package-lock.json frontend/package.json frontend/package-lock.json frontend/eslint.config.mjs
```

Expected: `git diff --check` exits 0; both compiler versions are 7.x; `rg` returns no forbidden TypeScript 6/API-dependent tooling matches.
