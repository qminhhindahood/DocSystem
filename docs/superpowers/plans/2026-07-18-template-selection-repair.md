# Template Selection Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the template API and selector without data loss, preserve supported DOCX text boxes, and prevent templates with non-compliant typography from becoming `READY`.

**Architecture:** Apply a new additive Prisma repair migration because the recorded dynamic-template migration no longer matches the live legacy table. Extend renderer candidates with resolved formatting observations, validate them against Decree 30 rules in the backend compiler, and expose stable rejection guidance. Use the shared React Query cache for processing refreshes and a focused Generate selector component for explicit loading, error, empty, and ready states.

**Tech Stack:** PostgreSQL, Prisma 5, Express/TypeScript/Jest, .NET 10/Open XML/xUnit, Next.js 16/React 19/TanStack Query 5/Radix Select/Vitest.

## Global Constraints

- Never reset the database, delete templates, edit/replay `20260712184012_init_dynamic_templates`, or drop legacy `Template.filePath`/`Template.schema` columns.
- Preserve supported DrawingML and VML text-box geometry, wrapping, anchors, borders, fills, z-order, paragraph properties, and run properties.
- Require Times New Roman, Unicode text, black color, and semantic-role sizes/styles from Appendix I of Decree 30/2020/NĐ-CP before `READY`.
- Never rewrite a non-compliant font in the downloadable DOCX; preview-only substitution may warn but cannot mutate the package.
- Keep all template data owner-scoped and all rejection details free of document text.
- Preserve existing light/dark theme structure and design tokens.
- Follow red-green-refactor for every behavior change.

---

### Task 1: Add the forward-only schema repair

**Files:**
- Create: `backend/prisma/migrations/20260718090000_repair_dynamic_template_schema/migration.sql`
- Modify: `backend/scripts/check_migration_integrity.test.ts`

**Interfaces:**
- Consumes: the observed legacy `Template` shape and system owner `00000000-0000-0000-0000-000000000001`.
- Produces: every `Template` column/constraint in `schema.prisma`, without removing legacy data.

- [ ] **Step 1: Write the failing safety contract**

```ts
const templateRepairMigration = '20260718090000_repair_dynamic_template_schema';

test('dynamic template repair is additive and backfills ownership', () => {
  const sql = migrationSql(templateRepairMigration);
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "header" TEXT NOT NULL DEFAULT \'\'');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "signatureBlock" TEXT NOT NULL DEFAULT \'\'');
  expect(sql).toContain('ADD COLUMN IF NOT EXISTS "status" "TemplateStatus"');
  expect(sql).toContain(`SET "ownerId" = '${SYSTEM_OWNER_ID}'`);
  expect(sql).toContain('ALTER COLUMN "docType" DROP NOT NULL');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS "UserDocumentProfile"');
  expect(sql).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM\s+"Template"/i);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix backend -- scripts/check_migration_integrity.test.ts --runInBand`

Expected: FAIL because the repair migration file is absent.

- [ ] **Step 3: Add the minimal idempotent migration**

Create the enum inside a `DO ... duplicate_object` block. Add `header`, `signatureBlock`, `ownerId`, `originalPath`, `originalSha256`, `fileSize`, `status`, `semanticMap`, `generationSchema`, `analysisConfidence`, `compatibilityReport`, `previewMetadata`, `rejectionCode`, and `rejectionReason` with `ADD COLUMN IF NOT EXISTS`. Then execute this exact safe ordering:

```sql
ALTER TABLE "Template" ALTER COLUMN "docType" DROP NOT NULL;

INSERT INTO "User" ("id", "username", "passwordHash", "role", "isDisabled", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'system-owner', '!system-owner-disabled!', 'user', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "isDisabled" = true;

UPDATE "Template"
SET "ownerId" = '00000000-0000-0000-0000-000000000001',
    "status" = 'REJECTED',
    "rejectionCode" = 'LEGACY_STATIC_RETIRED',
    "rejectionReason" = 'Mẫu cũ được giữ lại để đối soát và không dùng để tạo văn bản.'
WHERE "ownerId" IS NULL;

ALTER TABLE "Template"
  ALTER COLUMN "ownerId" SET NOT NULL,
  ALTER COLUMN "ownerId" SET DEFAULT '00000000-0000-0000-0000-000000000001',
  ALTER COLUMN "status" SET DEFAULT 'REJECTED';
```

Add a guarded type conversion only when an existing `status` column is not `TemplateStatus`; create the two owner indexes; add the owner foreign key only when `pg_constraint` lacks it; create `UserDocumentProfile` with its unique user foreign key exactly as defined in `schema.prisma`.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test --prefix backend -- scripts/check_migration_integrity.test.ts --runInBand
npx prisma validate --schema backend/prisma/schema.prisma
```

Expected: tests PASS and Prisma reports a valid schema.

- [ ] **Step 5: Commit**

```powershell
git add backend/prisma/migrations/20260718090000_repair_dynamic_template_schema/migration.sql backend/scripts/check_migration_integrity.test.ts
git commit -m "fix: repair dynamic template schema"
```

---

### Task 2: Resolve formatting and preserve text-box structure

**Files:**
- Modify: `document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Analysis/TextFormattingResolver.cs`
- Modify: `document-renderer/src/DocumentRenderer.Core/Analysis/StructuralAnalyzer.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/TextFormattingResolverTests.cs`
- Modify: `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs`

**Interfaces:**
- Produces: `ResolvedTextStyle` and optional `CandidateFormatting` on `StructuralCandidate`.
- Preserves: existing four-argument `StructuralCandidate` construction and snake_case JSON serialization.

- [ ] **Step 1: Write failing direct, inherited, VML, and DrawingML tests**

```csharp
[Theory]
[InlineData(true)]
[InlineData(false)]
public void AnalyzerResolvesCompliantTypography(bool inTextBox)
{
    var path = CreateDocument(inTextBox, "Times New Roman", "28", "000000", bold: true);
    var candidate = Assert.Single(new StructuralAnalyzer().Analyze(path).Candidates,
        item => item.TextSnippet == "NỘI DUNG");
    Assert.Equal(inTextBox, candidate.Formatting!.InTextBox);
    var style = Assert.Single(candidate.Formatting.Styles);
    Assert.Equal("Times New Roman", style.FontFamily);
    Assert.Equal(14, style.FontSizePoints);
    Assert.True(style.Bold);
    Assert.Equal("000000", style.Color);
}
```

Add an inherited-style fixture where the run has no direct properties, the paragraph uses `BodyStyle`, and `styles.xml` supplies Times New Roman at 26 half-points. Add VML and DrawingML insertion assertions that the shape fingerprint and resolved style are unchanged.

- [ ] **Step 2: Verify RED**

Run: `dotnet test document-renderer/tests/DocumentRenderer.Tests/DocumentRenderer.Tests.csproj --filter "FullyQualifiedName~TextFormattingResolverTests"`

Expected: build FAIL because formatting contracts do not exist.

- [ ] **Step 3: Add contracts and resolver**

```csharp
public sealed record ResolvedTextStyle(string FontFamily, double? FontSizePoints, bool Bold, bool Italic, string Color);
public sealed record CandidateFormatting(bool InTextBox, IReadOnlyList<ResolvedTextStyle> Styles);
public sealed record StructuralCandidate(
    string Locator, string Kind, IReadOnlyDictionary<string, string>? Fingerprint,
    string TextSnippet, CandidateFormatting? Formatting = null);
```

Implement `TextFormattingResolver.Resolve(WordprocessingDocument, Paragraph)` with precedence: direct run properties, character style, paragraph style, document defaults, theme font. Normalize `auto` color to `000000`; keep unresolved font as `""`; convert half-points using invariant culture. Attach distinct text-bearing styles and the existing `txbxContent` ancestor result in `StructuralAnalyzer`.

- [ ] **Step 4: Verify GREEN and regression safety**

Run:

```powershell
dotnet test document-renderer/tests/DocumentRenderer.Tests/DocumentRenderer.Tests.csproj --filter "FullyQualifiedName~TextFormattingResolverTests|FullyQualifiedName~SemanticInsertionPreserves"
dotnet test document-renderer/tests/DocumentRenderer.Tests/DocumentRenderer.Tests.csproj
```

Expected: focused and full suites PASS with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs document-renderer/src/DocumentRenderer.Core/Analysis/TextFormattingResolver.cs document-renderer/src/DocumentRenderer.Core/Analysis/StructuralAnalyzer.cs document-renderer/tests/DocumentRenderer.Tests/TextFormattingResolverTests.cs document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs
git commit -m "feat: inspect template typography and text boxes"
```

---

### Task 3: Enforce Decree 30 typography in the compiler

**Files:**
- Modify: `backend/src/types/templates.ts`
- Modify: `backend/src/services/template_service_client.ts`
- Create: `backend/src/services/template_typography_rules.ts`
- Create: `backend/src/services/template_typography_rules.test.ts`
- Modify: `backend/src/services/template_compiler.ts`
- Modify: `backend/src/services/template_compiler.test.ts`
- Modify: `backend/src/routes/templates.ts`
- Modify: `backend/src/routes/templates.contract.test.ts`

**Interfaces:**
- Produces: `validateTemplateTypography(docType, candidates, mappings): TypographyViolation[]`.
- Produces: owner-scoped `TemplateSummary.rejectionReason`.

- [ ] **Step 1: Write failing universal and semantic-role tests**

```ts
it.each(['Arial', 'Calibri', ''])('rejects invalid or unresolved font %s', fontFamily => {
  expect(validateTemplateTypography(null, [candidate({ fontFamily })], []))
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FONT_FAMILY_INVALID' })]));
});

it('accepts compliant body text inside a text box', () => {
  expect(validateTemplateTypography('cong-van', [candidate({
    kind: 'FLOATING_TEXT_BOX', fontFamily: 'Times New Roman', fontSizePoints: 14,
    bold: false, italic: false, color: '000000',
  })], [mapping('content_items')])).toEqual([]);
});
```

Cover black/auto color, `document_number` 13 pt regular, `place`/`date_vn` 13–14 pt italic, typed-document `subject` 13–14 pt bold, công-văn `subject` 12–13 pt regular, body 13–14 pt, `distributionList` 11–12 pt, and signatory roles 13–14 pt bold.

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix backend -- src/services/template_typography_rules.test.ts --runInBand`

Expected: FAIL because the validator module is absent.

- [ ] **Step 3: Extend and normalize the renderer contract**

```ts
export interface ResolvedTextStyle {
  fontFamily: string;
  fontSizePoints: number | null;
  bold: boolean;
  italic: boolean;
  color: string;
}
export interface CandidateFormatting { inTextBox: boolean; styles: ResolvedTextStyle[]; }
export interface TypographyViolation {
  code: 'FONT_FAMILY_INVALID' | 'FONT_SIZE_INVALID' | 'FONT_WEIGHT_INVALID' |
    'FONT_STYLE_INVALID' | 'FONT_COLOR_INVALID' | 'FONT_FORMAT_UNRESOLVED';
  locator: string;
  field?: string;
  actual: string;
  expected: string;
}
```

Normalize `candidate.formatting` in `template_service_client.ts`. Malformed/missing formatting becomes `{ inTextBox: kind === 'FLOATING_TEXT_BOX', styles: [] }` so validation fails closed.

- [ ] **Step 4: Implement the pure validator**

```ts
const ROLE_RULES = {
  agency_name: { min: 12, max: 13 },
  document_number: { min: 13, max: 13, bold: false, italic: false },
  place: { min: 13, max: 14, italic: true },
  date_vn: { min: 13, max: 14, italic: true },
  recipient: { min: 13, max: 14, italic: false },
  legal_basis: { min: 13, max: 14, italic: true },
  content_items: { min: 13, max: 14, italic: false },
  distributionList: { min: 11, max: 12 },
  signatory_name: { min: 13, max: 14, bold: true },
  signatory_title: { min: 13, max: 14, bold: true },
} as const;
```

Use a dynamic subject rule: công văn 12–13 pt regular; other document types 13–14 pt bold. Validate every text-bearing style universally for Times New Roman and black, then apply role rules only to final mapped candidates. Never include `textSnippet` in violations.

- [ ] **Step 5: Verify rule GREEN**

Run: `npm test --prefix backend -- src/services/template_typography_rules.test.ts --runInBand`

Expected: all cases PASS.

- [ ] **Step 6: Write failing compiler-gate tests**

```ts
it('never promotes a mapped font violation to READY', async () => {
  findFirst.mockResolvedValue(reviewableTemplate(candidateWithStyle('Arial', 13)));
  await recompileSchema('t1', 'u1', reviewedMap);
  expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    status: 'REJECTED', rejectionCode: 'FONT_RULE_VIOLATION',
  }) }));
});
```

Add an analysis test proving a universal font/color violation rejects before vision and persists `previewMetadata.typographyViolations`. Add a route test proving `rejectionReason` is returned without weakening owner scoping.

- [ ] **Step 7: Integrate the gate and guidance**

Validate universal rules after renderer analysis and before vision. Validate semantic-role rules after vision mapping and during `recompileSchema`. On violation persist `REJECTED`, `FONT_RULE_VIOLATION`, bounded `rejectionReason` (maximum 500 characters), and the violations in preview metadata. Mapping review must not override compatibility or typography rejection.

- [ ] **Step 8: Verify GREEN and build**

```powershell
npm test --prefix backend -- src/services/template_typography_rules.test.ts src/services/template_compiler.test.ts src/routes/templates.contract.test.ts --runInBand
npm run build --prefix backend
```

Expected: focused suites PASS and TypeScript build exits 0.

- [ ] **Step 9: Commit**

```powershell
git add backend/src/types/templates.ts backend/src/services/template_service_client.ts backend/src/services/template_typography_rules.ts backend/src/services/template_typography_rules.test.ts backend/src/services/template_compiler.ts backend/src/services/template_compiler.test.ts backend/src/routes/templates.ts backend/src/routes/templates.contract.test.ts
git commit -m "feat: enforce template typography rules"
```

---

### Task 4: Replace the placeholder-only Generate control

**Files:**
- Modify: `frontend/lib/templates-api.ts`
- Create: `frontend/components/templates/ReadyTemplateSelect.tsx`
- Create: `frontend/test/ready-template-select.test.tsx`
- Modify: `frontend/app/(app)/generate/page.tsx`

**Interfaces:**
- Produces: `ReadyTemplateSelect` with `templates`, `value`, `onValueChange`, `isLoading`, `error`, and `onRetry` props.

- [ ] **Step 1: Write failing state tests**

```tsx
it('disables the selector and links to Templates when no READY template exists', () => {
  render(<ReadyTemplateSelect templates={[]} value="" onValueChange={vi.fn()}
    isLoading={false} error={null} onRetry={vi.fn()} />);
  expect(screen.getByRole('combobox')).toBeDisabled();
  expect(screen.getByRole('link', { name: /đến trang mẫu văn bản/i })).toHaveAttribute('href', '/templates');
  expect(screen.queryByText('-- Chọn mẫu đã sẵn sàng --')).not.toBeInTheDocument();
});

it('shows an API error and retries without showing an empty-library message', async () => {
  const retry = vi.fn();
  render(<ReadyTemplateSelect templates={[]} value="" onValueChange={vi.fn()}
    isLoading={false} error={new Error('Template API failed')} onRetry={retry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Template API failed');
  await userEvent.click(screen.getByRole('button', { name: /thử lại/i }));
  expect(retry).toHaveBeenCalledOnce();
});
```

Add a test that opens the Radix list, sees only real ready templates, and selects one.

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix frontend -- test/ready-template-select.test.tsx --run`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the focused component**

```tsx
<Select
  value={value}
  onValueChange={onValueChange}
  options={templates.map(template => ({ value: template.id, label: template.name }))}
  placeholder={isLoading ? 'Đang tải mẫu DOCX…' : 'Chọn mẫu DOCX'}
  disabled={isLoading || Boolean(error) || templates.length === 0}
/>
```

Use existing design tokens. Show local `role="alert"` error plus `Thử lại`; show `Chưa có mẫu DOCX sẵn sàng.` plus link `Đến trang Mẫu văn bản`; never pass an empty-string option.

- [ ] **Step 4: Integrate Generate query state**

Destructure `isLoading`, `error`, and `refetch`; remove the effect that copies template fetch errors into the generation error. Add stale-selection clearing:

```tsx
useEffect(() => {
  if (selectedTemplateId && !readyTemplates.some(template => template.id === selectedTemplateId)) {
    setSelectedTemplateId('');
  }
}, [readyTemplates, selectedTemplateId]);
```

Preserve document-type synchronization in `onValueChange`.

- [ ] **Step 5: Verify GREEN, lint, and build**

```powershell
npm test --prefix frontend -- test/ready-template-select.test.tsx --run
npm run lint --prefix frontend
npm run build --prefix frontend
```

Expected: tests PASS, lint is clean, build exits 0.

- [ ] **Step 6: Commit in the frontend repository**

```powershell
git -C frontend add lib/templates-api.ts components/templates/ReadyTemplateSelect.tsx test/ready-template-select.test.tsx 'app/(app)/generate/page.tsx'
git -C frontend commit -m "fix: show reliable template selector states"
```

---

### Task 5: Refresh processing templates and explain rejections

**Files:**
- Modify: `frontend/lib/templates-api.ts`
- Modify: `frontend/app/(app)/templates/page.tsx`
- Modify: `frontend/components/templates/TemplateStatusCard.tsx`
- Modify: `frontend/test/templates-page.test.tsx`

**Interfaces:**
- Produces: `getTemplateRefetchInterval(data): 2000 | false`.
- Consumes: `TemplateSummary.rejectionCode` and `rejectionReason`.

- [ ] **Step 1: Write failing polling/guidance tests**

```ts
expect(getTemplateRefetchInterval({ templates: [{ ...base, status: 'ANALYZING' }] })).toBe(2000);
expect(getTemplateRefetchInterval({ templates: [{ ...base, status: 'READY' }] })).toBe(false);
```

With fake timers, return `ANALYZING` then `NEEDS_REVIEW`, advance 2000 ms, and assert two calls plus the `Xem lại` action. Add a rejected-card assertion that `FONT_RULE_VIOLATION` displays `Phông chữ hoặc cỡ chữ chưa đúng quy định` and the sanitized reason.

- [ ] **Step 2: Verify RED**

Run: `npm test --prefix frontend -- test/templates-page.test.tsx --run`

Expected: FAIL because polling and translated guidance are absent.

- [ ] **Step 3: Use the shared query cache**

```tsx
const templatesQuery = useQuery({
  queryKey: ['templates'],
  queryFn: ({ signal }) => getTemplates(signal),
  refetchInterval: query => getTemplateRefetchInterval(query.state.data),
  refetchIntervalInBackground: false,
});
```

Implement the helper to return 2000 only for `UPLOADED`/`ANALYZING`; otherwise false. Handle `AuthError` in an effect. Use `refetch` for Refresh and `invalidateQueries({ queryKey: ['templates'] })` after upload/review.

- [ ] **Step 4: Translate rejection codes**

```ts
const REJECTION_LABELS: Record<string, string> = {
  FONT_RULE_VIOLATION: 'Phông chữ hoặc cỡ chữ chưa đúng quy định',
  UNSUPPORTED_DOCX_STRUCTURE: 'Mẫu có cấu trúc DOCX chưa được hỗ trợ',
  LEGACY_STATIC_RETIRED: 'Mẫu cũ chỉ được giữ lại để đối soát',
};
```

Show the localized label and bounded reason; show raw code only as an unknown-code fallback.

- [ ] **Step 5: Verify GREEN and full frontend suite**

```powershell
npm test --prefix frontend -- test/templates-page.test.tsx --run
npm test --prefix frontend -- --run
```

Expected: focused/full suites PASS.

- [ ] **Step 6: Commit in the frontend repository**

```powershell
git -C frontend add lib/templates-api.ts 'app/(app)/templates/page.tsx' components/templates/TemplateStatusCard.tsx test/templates-page.test.tsx
git -C frontend commit -m "fix: refresh template processing states"
```

---

### Task 6: Deploy and verify end to end

**Files:** No new production files expected.

**Interfaces:** Consumes Tasks 1–5 and produces a live schema plus verified upload/review/select/generate behavior.

- [ ] **Step 1: Run complete pre-deploy verification**

```powershell
npm test --prefix backend -- --runInBand
npm run build --prefix backend
dotnet test document-renderer/tests/DocumentRenderer.Tests/DocumentRenderer.Tests.csproj
npm test --prefix frontend -- --run
npm run lint --prefix frontend
npm run build --prefix frontend
```

Expected: every command exits 0 with zero failures.

- [ ] **Step 2: Apply the additive migration**

```powershell
npx prisma migrate deploy --schema backend/prisma/schema.prisma
npx prisma generate --schema backend/prisma/schema.prisma
```

Expected: only the new repair migration is applied; no reset prompt.

- [ ] **Step 3: Verify schema and runtime**

Run a bounded Prisma smoke query selecting only `id`, `status`, `ownerId`, `fileSize`, and `rejectionCode`; expect no `P2022`. Run `npx prisma migrate status --schema backend/prisma/schema.prisma`; expect “Database schema is up to date.” Restart only the existing PID on port 3001 and verify exactly one listener with `Get-NetTCPConnection -LocalPort 3001 -State Listen`.

- [ ] **Step 4: Verify compliant and non-compliant fixtures**

With a dedicated local test user, upload a compliant Times New Roman DOCX containing body text plus a supported text box. Verify `UPLOADED/ANALYZING → NEEDS_REVIEW or READY`; submit a valid owner-scoped mapping if review is needed; select the real template on `/generate`; generate and inspect the output package for declared Times New Roman, unchanged shape fingerprint, and inserted mapped text.

Upload an Arial fixture and verify `REJECTED` + `FONT_RULE_VIOLATION`, absence from Generate, and Vietnamese correction guidance in Templates.

- [ ] **Step 5: Review repository state**

```powershell
git status --short
git diff --check
git -C frontend status --short
git -C frontend diff --check
```

Expected: only known pre-existing user changes remain and no whitespace errors are reported.
