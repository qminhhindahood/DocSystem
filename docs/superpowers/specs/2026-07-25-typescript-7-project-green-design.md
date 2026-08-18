# TypeScript 7 Project-Green Design

## Goal

Make the repository's standard verification workflow pass while using TypeScript
7 as the only installed TypeScript compiler. The backend and frontend must build,
test, lint, and run without TypeScript 6, `@typescript/typescript6`, or any tool
that expects the removed TypeScript 6 JavaScript compiler API.

## Current State

Both Node applications resolve `typescript` to 7.0.2. The native compiler itself
works: the backend `tsc` build passes, and the frontend compiler reports ordinary
source syntax errors. The ecosystem around the compiler is not fully compatible:

- Backend development uses `ts-node-dev`, whose `ts-node` dependency calls the
  JavaScript compiler API. TypeScript 7 exposes version metadata but not API
  functions such as `createProgram`, `transpileModule`, or `sys`.
- Frontend linting imports `typescript-eslint` through `eslint-config-next`.
  `typescript-eslint` rejects TypeScript 7 during module initialization.
- Next.js 16.2 performs its built-in build-time type check through the TypeScript
  JavaScript API. It cannot perform that check using the TypeScript 7 package.
- Frontend production compilation is also blocked by malformed template strings
  in the proxy route.
- Existing backend and frontend test suites contain additional failures,
  including transform/mocking behavior, platform-sensitive file paths, missing
  or mismatched exports, unintended database access, source-policy assertions,
  and the malformed proxy route.

The official TypeScript 7 guidance recommends running TypeScript 6 and 7
side-by-side for API-dependent tools. That bridge is intentionally excluded
because the approved requirement is a strict TypeScript 7-only project.

## Architecture

TypeScript 7 owns all static type checking and backend emission. Tools that only
need to erase TypeScript syntax use API-independent parsers or transformers.
Framework and lint integrations that still require the TypeScript 6 API are
replaced or bypassed without weakening the verification gate.

The command flow is:

1. API-independent tools transform TypeScript for development and unit tests.
2. TypeScript 7 performs an explicit project-wide type check.
3. Next.js builds only after that explicit check succeeds.
4. Repository verification runs tests, lint, builds, schema checks, audits,
   auxiliary-language checks, Compose contracts, and whitespace integrity.

No TypeScript 6 package is installed at any point in this flow.

## Backend Toolchain

The backend keeps `typescript@^7.0.0` and `tsx`. The `dev` script changes from
`ts-node-dev --respawn --transpile-only src/index.ts` to an equivalent `tsx watch`
command. `tsx` performs development-time syntax transformation without calling
the TypeScript compiler API. The production `build` command remains `tsc`, so
emitted JavaScript is produced by TypeScript 7.

Jest will transform TypeScript through `babel-jest`, `@babel/preset-env`, and
`@babel/preset-typescript`. This path does not use the TypeScript compiler API
and preserves Jest's module-mock hoisting semantics. The superseded SWC Jest
transform and obsolete `ts-node-dev`/`ts-node` dependencies will be removed when
no longer referenced.

The backend test configuration will explicitly separate source compilation
settings from test-global settings. Production compilation remains limited to
`src` and excludes test files; test type checking includes the Jest and Node
global types it actually uses.

## Frontend Toolchain

The frontend keeps `typescript@^7.0.0` as its only TypeScript package and adds a
dedicated `typecheck` script that runs `tsc --noEmit`. The `build` script runs
that type check before `next build`.

Next.js's `typescript.ignoreBuildErrors` option will be enabled solely to prevent
Next.js from invoking its incompatible TypeScript JavaScript-API checker. It
does not allow unchecked production builds because the package script makes the
TypeScript 7 check a mandatory predecessor. CI and repository verification use
the package script, never a bare `next build`.

`eslint-config-next` will be removed because importing it initializes
`typescript-eslint`. ESLint remains in place with `@babel/eslint-parser` using
Next.js's Babel preset and direct React, React Hooks, accessibility, import, and
Next.js plugins. The replacement flat configuration will preserve the
applicable recommended and Core Web Vitals rules, the existing intentional
`react-hooks/set-state-in-effect` exception, and the current generated-file
ignores. TypeScript 7, rather than the linter, is responsible for type-aware
diagnostics.

Vitest and Vite remain because their transformation pipeline does not depend on
the removed TypeScript compiler API.

## Source and Test Repairs

Repairs will be evidence-driven and limited to failures reached by the standard
verification workflow.

- Fix malformed frontend proxy route expressions and retain the route's
  forwarding and security behavior.
- Restore Jest-compatible mock initialization so tests use declared mocks
  instead of real Prisma clients or temporal-dead-zone bindings.
- Make storage tests and implementation use platform-correct absolute paths,
  preserving ownership and hash-validation guarantees.
- Reconcile authentication middleware exports and behavior with their contract
  and security tests.
- Repair frontend source-policy failures without weakening the design-system
  assertions.
- Address every newly exposed TypeScript 7 diagnostic at its source. Compiler
  options will not be relaxed merely to suppress errors.
- Fix any subsequent build or test failures one root cause at a time. Tests will
  not be deleted, skipped, broadly mocked, or converted into unconditional
  passes to reach green status.

Tests that represent unit or contract behavior must be hermetic. They may not
require a live PostgreSQL, Redis, renderer, embedding service, or LLM unless the
repository explicitly classifies them as integration tests and the verification
step provisions that dependency.

## Error Handling and Safety

Every change will preserve the existing user work in the dirty worktree. Files
outside the failing verification path will not be reformatted or refactored.
Where a failing test conflicts with an intentional current implementation, the
documented security and ownership requirements take priority and the mismatch
will be resolved explicitly.

The Next.js type-check bypass must always remain paired with the TypeScript 7
prebuild gate. A verification test or script assertion will prevent a future
change from leaving `ignoreBuildErrors` enabled without the explicit
`typecheck` predecessor.

Package changes must leave lockfiles reproducible. Dependency overrides will be
retained when they serve an existing security constraint and removed only when
their owning dependency is removed.

## Verification

Implementation is complete only when all applicable checks pass from a clean
command invocation:

### TypeScript 7 proof

- Backend and frontend `tsc --version` report 7.x.
- Dependency trees contain no TypeScript 6 package or compatibility alias.
- `npm ls` reports no invalid TypeScript peer dependency.
- Backend development startup no longer loads `ts-node`.
- Frontend lint and build do not initialize `typescript-eslint` or Next.js's
  legacy type checker.

### Backend

- Full Jest suite.
- Prisma schema validation.
- SQL/schema synchronization check.
- Migration-integrity tests.
- TypeScript 7 production build.
- Moderate-or-higher dependency audit gate.

### Frontend

- Full Vitest suite.
- ESLint with zero warnings.
- Explicit TypeScript 7 no-emit check.
- Next.js production build through the guarded package script.
- Moderate-or-higher dependency audit gate.

### Repository

- .NET renderer tests and Release build.
- Docling and embeddings Python tests and compile checks.
- Development and production Compose contract checks.
- Operations Pester tests.
- `git diff --check`.
- `ops/verify-all.ps1` reaches `All verification steps passed.`

Optional cutover rehearsal and renderer-container smoke checks remain opt-in
because the repository's verification script already classifies them that way.

## Completion Criteria

The repository is green only when the standard verification script passes and
the TypeScript 7 proof checks pass. A partial result such as a successful
compiler run with broken linting, a successful Next.js bundle with skipped
external type checking, or passing unit tests with live-service dependencies is
not sufficient.
