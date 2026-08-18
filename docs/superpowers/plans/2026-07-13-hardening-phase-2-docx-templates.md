# High-Fidelity DOCX Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generated static templates with private user-uploaded DOCX rendering shells that are automatically mapped, preserve floating text boxes, and pass structural and visual fidelity checks before download.

**Architecture:** A private .NET renderer performs safe Open XML inspection/editing and Aspose page rendering. The Node backend owns authentication, database state, model calls, generation schemas, and owner-scoped RAG. Template compilation fuses stable structural locators with labeled-page vision analysis; rendering writes semantic values into existing objects and verifies the result against a baseline fingerprint.

**Tech Stack:** .NET 10 LTS, ASP.NET Core minimal APIs, xUnit, Open XML SDK 3.5.1, Aspose.Words 26.7.0, ImageSharp 3.1.11, Node/Express/Prisma, Zod, Multer 2, Jest, Docker.

## Global Constraints

- `ASPOSE_LICENSE_PATH` and all `RENDERER_REQUIRED_FONTS` must be available before renderer readiness returns 200.
- The renderer has no host-published port and accepts only `X-Renderer-Token` from the backend.
- Store immutable originals under `originals/<ownerId>/<templateId>.docx`; generated outputs and previews use separate subtrees.
- Maximum upload is 20 MiB, maximum uncompressed package size is 100 MiB, maximum ZIP entries is 5,000, and maximum compression ratio is 100:1.
- Reject DOCM, encrypted packages, external relationships, OLE/ActiveX, path traversal, symlink escapes, and hash mismatches.
- Never recreate a floating shape. Replace only text descendants in an existing text frame and assert its anchor/geometry fingerprint is unchanged.
- A `READY` template must have confidence at least `0.92`, no required field below `0.85`, a valid baseline render, and no compatibility errors.

---

### Task 1: Scaffold the Private Renderer and Fail-Closed Readiness

**Files:**
- Create: `document-renderer/DocumentRenderer.sln`
- Create: `document-renderer/src/DocumentRenderer.Api/DocumentRenderer.Api.csproj`
- Create: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Create: `document-renderer/src/DocumentRenderer.Api/Configuration/RendererOptions.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/DocumentRenderer.Core.csproj`
- Create: `document-renderer/tests/DocumentRenderer.Tests/DocumentRenderer.Tests.csproj`
- Create: `document-renderer/tests/DocumentRenderer.Tests/ReadinessTests.cs`
- Create: `document-renderer/Dockerfile`
- Create: `document-renderer/.dockerignore`

**Interfaces:**
- Produces: `GET /live` and `GET /ready`.
- Produces: `RendererOptions` with `StorageRoot`, `AsposeLicensePath`, `RequiredFonts`, and `ServiceToken`.

- [ ] **Step 1: Create projects and a failing readiness test**

Pin these package references in the project files:

```xml
<TargetFramework>net10.0</TargetFramework>
<Nullable>enable</Nullable>
<ImplicitUsings>enable</ImplicitUsings>
<PackageReference Include="DocumentFormat.OpenXml" Version="3.5.1" />
<PackageReference Include="Aspose.Words" Version="26.7.0" />
<PackageReference Include="SixLabors.ImageSharp" Version="3.1.11" />
```

Use xUnit `2.9.3`, `Microsoft.NET.Test.Sdk` `17.14.1`, and `Microsoft.AspNetCore.Mvc.Testing` `10.0.9`. Test that `/live` is always 200 and `/ready` is 503 when the license or a declared font is missing.

- [ ] **Step 2: Run tests to verify the API does not exist**

Run: `dotnet test document-renderer/DocumentRenderer.sln`

Expected: FAIL because endpoints and options are absent.

- [ ] **Step 3: Implement options, internal-token middleware, and readiness**

```csharp
public sealed record RendererOptions {
    public required string StorageRoot { get; init; }
    public required string AsposeLicensePath { get; init; }
    public required string[] RequiredFonts { get; init; }
    public required string ServiceToken { get; init; }
}

app.MapGet("/live", () => Results.Ok(new { status = "alive" }));
app.MapGet("/ready", (RendererReadiness readiness) =>
    readiness.Check() is { Ready: true } result
        ? Results.Ok(result)
        : Results.Json(readiness.Check(), statusCode: 503));
```

All `/internal/*` endpoints compare UTF-8 token bytes with `CryptographicOperations.FixedTimeEquals`. Readiness loads the Aspose license, configures `FontSettings.DefaultInstance.SetFontsFolder`, checks every required font, checks write access to the storage root, and returns only stable error codes—never license contents or filesystem paths.

- [ ] **Step 4: Run renderer tests and Release build**

Run: `dotnet test document-renderer/DocumentRenderer.sln && dotnet build document-renderer/DocumentRenderer.sln -c Release --no-restore`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add document-renderer
git commit -m "feat: scaffold fail-closed DOCX renderer"
```

### Task 2: Validate Packages and Resolve Storage Paths Safely

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Security/StoragePathResolver.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Security/DocxPackageValidator.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Contracts/PackageValidationReport.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/StoragePathResolverTests.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/DocxPackageValidatorTests.cs`
- Create fixtures: `document-renderer/tests/DocumentRenderer.Tests/Fixtures/{valid.docx,external-link.docx,ole.docx,encrypted.bin,zip-bomb.docx}`

**Interfaces:**
- Produces: `string StoragePathResolver.ResolveExisting(string relativePath)`.
- Produces: `Task<PackageValidationReport> DocxPackageValidator.ValidateAsync(Stream input, CancellationToken)`.

- [ ] **Step 1: Write failing traversal, link, and package tests**

```csharp
[Theory]
[InlineData("../secret.docx")]
[InlineData("/etc/passwd")]
[InlineData("C:\\Windows\\win.ini")]
public void ResolveExisting_RejectsEscapes(string value) =>
    Assert.Throws<UnsafePathException>(() => resolver.ResolveExisting(value));

[Theory]
[InlineData("external-link.docx", "EXTERNAL_RELATIONSHIP")]
[InlineData("ole.docx", "EMBEDDED_OBJECT")]
[InlineData("encrypted.bin", "NOT_DOCX")]
[InlineData("zip-bomb.docx", "ZIP_LIMIT_EXCEEDED")]
public async Task Validate_RejectsUnsafePackages(string fixture, string code) =>
    Assert.Equal(code, (await ValidateFixture(fixture)).Code);
```

- [ ] **Step 2: Run and observe failure**

Run: `dotnet test document-renderer/DocumentRenderer.sln --filter "StoragePathResolverTests|DocxPackageValidatorTests"`

Expected: FAIL because validators are absent.

- [ ] **Step 3: Implement canonical resolution and package limits**

Resolve with `Path.GetFullPath(Path.Combine(root, relativePath))`, require the result to start with `root + Path.DirectorySeparatorChar`, and walk every existing path component using `ResolveLinkTarget(true)`; reject any link. In package validation, verify ZIP magic, content types, `word/document.xml`, entry count, total uncompressed size, per-entry and aggregate compression ratios. Open with `WordprocessingDocument` and reject every `ExternalRelationship`, `HyperlinkRelationship` with an external URI, `OleObject`, and ActiveX part.

```csharp
public sealed record PackageValidationReport(
    bool Valid,
    string Code,
    long FileSize,
    string Sha256,
    IReadOnlyList<string> Warnings);
```

- [ ] **Step 4: Rerun focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add document-renderer/src/DocumentRenderer.Core/Security document-renderer/src/DocumentRenderer.Core/Contracts/PackageValidationReport.cs document-renderer/tests/DocumentRenderer.Tests
git commit -m "feat: validate DOCX packages and storage paths"
```

### Task 3: Extract Stable Locators and Floating-Shape Fingerprints

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Analysis/StructuralAnalyzer.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Analysis/StructuralLocator.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Analysis/ShapeFingerprint.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Analysis/DocumentFingerprint.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/StructuralAnalyzerTests.cs`
- Create fixtures: `document-renderer/tests/DocumentRenderer.Tests/Fixtures/{drawingml-textboxes.docx,vml-textboxes.docx,linked-textboxes.docx,nested-tables.docx}`

**Interfaces:**
- Produces: `StructuralAnalysis StructuralAnalyzer.Analyze(string absolutePath)`.
- `StructuralAnalysis` contains `DocumentFingerprint`, `CandidateRegion[]`, compatibility errors, and warnings.

- [ ] **Step 1: Write failing structural coverage tests**

```csharp
var analysis = analyzer.Analyze(Fixture("drawingml-textboxes.docx"));
var box = Assert.Single(analysis.Candidates, x => x.Kind == RegionKind.FloatingTextBox);
Assert.Equal("main/document/p[3]/r[1]/drawing[1]/anchor[1]/textbox[1]", box.Locator.Path);
Assert.NotNull(box.Shape);
Assert.Equal(ShapeAnchorKind.Page, box.Shape.RelativeVerticalPosition);
Assert.Equal(914400L, box.Shape.WidthEmu);
Assert.NotEmpty(box.Text);
```

Add assertions for body paragraphs, nested table cells, headers, footers, footnotes, bookmarks, content controls, fields, VML boxes, DrawingML boxes, grouped shapes, linked frames, wrap mode, z-order, rotation, margins, auto-size, run style, paragraph style, and numbering ID.

- [ ] **Step 2: Run and observe failure**

Run: `dotnet test document-renderer/DocumentRenderer.sln --filter StructuralAnalyzerTests`

Expected: FAIL because no analyzer exists.

- [ ] **Step 3: Implement stable part-relative locators and fingerprints**

```csharp
public sealed record StructuralLocator(string PartUri, string Path, RegionKind Kind);
public sealed record ShapeFingerprint(
    string Locator,
    string AnchorLocator,
    long LeftEmu,
    long TopEmu,
    long WidthEmu,
    long HeightEmu,
    string HorizontalReference,
    string VerticalReference,
    string WrapMode,
    int ZOrder,
    int Rotation,
    long MarginLeftEmu,
    long MarginTopEmu,
    long MarginRightEmu,
    long MarginBottomEmu,
    bool AutoSize,
    string? LinkedNextLocator);
```

Generate locators from package part URI plus sibling indexes, never visible text or runtime object hashes. Canonicalize fingerprints as ordered JSON and SHA-256 them. Report unsupported AlternateContent branches, canvas objects, SmartArt, and unaddressable grouped-text shapes as compatibility errors instead of guessing.

- [ ] **Step 4: Run structural tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add document-renderer/src/DocumentRenderer.Core/Analysis document-renderer/tests/DocumentRenderer.Tests
git commit -m "feat: fingerprint DOCX structure and floating shapes"
```

### Task 4: Render Baselines and Produce Vision-Labeled Candidate Pages

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/BaselineRenderer.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/CandidateOverlayRenderer.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Contracts/AnalyzeTemplateRequest.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Contracts/AnalyzeTemplateResponse.cs`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/BaselineRendererTests.cs`

**Interfaces:**
- Produces: `POST /internal/templates/analyze` accepting `{ templateId, relativePath, sha256 }`.
- Returns: fingerprint, candidates, compatibility report, and storage-relative baseline/labeled page paths.

- [ ] **Step 1: Write failing baseline/overlay tests**

Use `docs/12-2017-tt-bgddt-19-05-2017.docx` as the representative administrative document. Assert analysis renders every page at 144 DPI, labels every candidate with its stable ID, stores artifacts under `previews/<templateId>/baseline` and `previews/<templateId>/labeled`, and never changes the original hash.

- [ ] **Step 2: Run and observe failure**

Run: `dotnet test document-renderer/DocumentRenderer.sln --filter BaselineRendererTests`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic rendering**

Load the Aspose license and exact font directory, call `UpdatePageLayout`, render PNG pages at 144 DPI, and calculate candidate bounds through Aspose layout collector/enumerator APIs. Draw opaque high-contrast labels outside text when space permits and leader lines into the region. Return only relative paths. Verify the input SHA-256 before opening and after rendering.

```csharp
public sealed record AnalyzeTemplateResponse(
    string DocumentFingerprint,
    IReadOnlyList<CandidateRegionDto> Candidates,
    IReadOnlyList<string> BaselinePages,
    IReadOnlyList<string> LabeledPages,
    CompatibilityReport Compatibility);
```

- [ ] **Step 4: Rerun tests with a valid test license/font directory**

Run: `dotnet test document-renderer/DocumentRenderer.sln --filter BaselineRendererTests` with `ASPOSE_LICENSE_PATH` and `RENDERER_FONT_DIR` already configured to the approved test assets.

Expected: PASS; original fixture hash unchanged.

- [ ] **Step 5: Commit**

```bash
git add document-renderer/src/DocumentRenderer.Core/Rendering document-renderer/src/DocumentRenderer.Core/Contracts document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests/BaselineRendererTests.cs
git commit -m "feat: render labeled DOCX analysis pages"
```

### Task 5: Secure Private Template Upload and Owner-Scoped API

**Files:**
- Replace: `backend/src/routes/templates.ts`
- Create: `backend/src/services/template_storage_service.ts`
- Create: `backend/src/services/template_service_client.ts`
- Create: `backend/src/types/templates.ts`
- Create: `backend/src/routes/templates.contract.test.ts`
- Create: `backend/src/services/template_storage_service.test.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/.env.example`

**Interfaces:**
- Produces owner-scoped `GET /api/templates`, `GET /api/templates/:id`, `POST /api/templates`, `POST /api/templates/:id/analyze`, `PATCH /api/templates/:id/mapping`, `GET /api/templates/:id/previews/:page`, and `DELETE /api/templates/:id`.
- Produces: `RendererClient.analyzeTemplate(input: AnalyzeTemplateInput): Promise<StructuralAnalysis>`.

- [ ] **Step 1: Add failing auth, validation, isolation, and cleanup tests**

Assert 401 without a token, 404 for another owner's ID, 413 above 20 MiB, 400 for renamed non-DOCX, ZIP bomb, external relationship, and missing name. Assert two templates with the same `docType` succeed. Force Prisma create failure and assert the temporary/original file is removed; force file deletion failure and assert DB metadata is retained with a stable error.

- [ ] **Step 2: Run and observe current unauthenticated/global behavior**

Run: `cd backend && npx jest src/routes/templates.contract.test.ts src/services/template_storage_service.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement atomic upload and typed contracts**

Use Multer memory storage with `limits.fileSize = 20 * 1024 * 1024`. Validate ZIP before persistence, calculate SHA-256, create the DB ID, write to `originals/<ownerId>/<id>.docx.tmp` using exclusive creation, fsync, rename atomically, and create the Prisma row with `ownerId`, `status: 'UPLOADED'`, legacy `header: ''`, and legacy `signatureBlock: ''`. On any failure, remove only the resolved temporary/final path.

```ts
export type TemplateStatus = 'UPLOADED' | 'ANALYZING' | 'NEEDS_REVIEW' | 'READY' | 'REJECTED' | 'FAILED';
export interface TemplateSummary {
  id: string;
  name: string;
  docType: string | null;
  status: TemplateStatus;
  analysisConfidence: number | null;
  rejectionCode: string | null;
  createdAt: string;
}
export interface FidelityReport {
  passed: boolean;
  violations: Array<{ code: string; field?: string; message: string }>;
  repairs: Array<{ policy: string; field: string }>;
  pageCount: number;
}
```

All Prisma reads use `{ id, ownerId: req.user!.userId }`. Return `{ success: true, templates }` for lists and `{ success: true, template }` for single resources. Preview routes resolve only paths already stored in that owner's `previewMetadata`.

- [ ] **Step 4: Rerun tests and build**

Run: `cd backend && npx jest src/routes/templates.contract.test.ts src/services/template_storage_service.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/templates.ts backend/src/services/template_storage_service.ts backend/src/services/template_service_client.ts backend/src/types/templates.ts backend/src/routes/templates.contract.test.ts backend/src/services/template_storage_service.test.ts backend/src/index.ts backend/src/utils/validateEnv.ts backend/.env.example
git commit -m "feat: secure private template uploads"
```

### Task 6: Fuse Structural Analysis with Vision into a Generation Schema

**Files:**
- Create: `backend/src/services/template_compiler.ts`
- Create: `backend/src/services/template_compiler.test.ts`
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/routes/templates.ts`
- Create: `backend/src/constants/template_semantics.ts`

**Interfaces:**
- Produces: `compileTemplate(templateId: string, ownerId: string): Promise<CompileResult>`.
- Produces: `callLLMVision(config, request, signal?): Promise<string>`.
- Produces semantic roles `issuingAgency`, `documentNumber`, `place`, `date`, `recipient`, `subject`, `legalBases`, `bodySections`, `distributionList`, `signatoryTitle`, and `signatoryName`.

- [ ] **Step 1: Write failing READY/NEEDS_REVIEW/REJECTED tests**

Mock renderer candidates and vision JSON. Assert confidence `0.94` with every required field at least `0.85` becomes `READY`; total `0.91` or a required field at `0.84` becomes `NEEDS_REVIEW`; compatibility errors become `REJECTED`; a text-only model response becomes `FAILED` with `VISION_MODEL_REQUIRED` and does not erase a previous `READY` map.

- [ ] **Step 2: Run and observe failure**

Run: `cd backend && npx jest src/services/template_compiler.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement the compiler state machine and strict response schema**

Use a conditional update from `UPLOADED|NEEDS_REVIEW|FAILED` to `ANALYZING` to prevent duplicate jobs. Send sanitized candidate text plus labeled page images to the owner's configured vision model. Require JSON matching:

```ts
const SemanticMapSchema = z.object({
  documentKind: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fields: z.record(z.object({
    locator: z.string().min(1),
    confidence: z.number().min(0).max(1),
    cardinality: z.enum(['one', 'optional', 'many']),
    valueType: z.enum(['string', 'date', 'stringArray', 'sectionArray', 'person']),
    overflowPolicy: z.enum(['linkedFrame', 'expand', 'tighten', 'shorten', 'fail']),
  })),
});
```

Reject locators absent from renderer candidates. Merge deterministic Vietnamese label scores with vision confidence using fixed weights `0.35 structural + 0.65 vision`. Derive a JSON Schema with `additionalProperties: false`. Store map/schema/report in one update and never log extracted text or images.

- [ ] **Step 4: Rerun compiler tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/template_compiler.ts backend/src/services/template_compiler.test.ts backend/src/services/llm_config_service.ts backend/src/routes/templates.ts backend/src/constants/template_semantics.ts
git commit -m "feat: compile DOCX templates with structural vision mapping"
```

### Task 7: Insert Semantic Values and Enforce the Fidelity Gate

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Editing/SemanticInserter.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Verification/FidelityVerifier.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Verification/OverflowRepair.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Contracts/RenderDocumentRequest.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Contracts/RenderDocumentResponse.cs`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/SemanticInserterTests.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/FidelityVerifierTests.cs`

**Interfaces:**
- Produces: `POST /internal/templates/render`.
- Returns: output relative path/hash and `FidelityReport { passed, violations, repairs, pageCount }`.

- [ ] **Step 1: Write failing floating-shape and overflow tests**

Insert new values into body, table, DrawingML text box, and VML text box fixtures. Assert original shape fingerprints equal output fingerprints, static part hashes are unchanged, expected text appears, clipping is detected, linked-frame flow is preferred, font never drops below the mapped minimum, repair attempts are bounded, and exhausted repair returns `passed: false` without a deliverable path.

- [ ] **Step 2: Run and observe failure**

Run: `dotnet test document-renderer/DocumentRenderer.sln --filter "SemanticInserterTests|FidelityVerifierTests"`

Expected: FAIL.

- [ ] **Step 3: Implement copy-on-write insertion and bounded verification**

Copy the original to a uniquely named temporary output under `generated/<ownerId>/<documentId>.docx.tmp`. Locate targets by exact part URI/path. Replace text descendants while cloning the target's run/paragraph properties. Clone mapped body prototypes for arrays. Save, update fields/layout, and render. Compare canonical structure fingerprints and masked page images. Apply at most one pass of each allowed policy in this order: linked frame, explicit expansion, spacing/font tightening within stored minimum, semantic shortening request. The .NET service performs deterministic repairs; if shortening is required, return `SHORTEN_REQUIRED` with field/max characters so the backend can regenerate once and resubmit.

```csharp
public sealed record FidelityReport(
    bool Passed,
    IReadOnlyList<FidelityViolation> Violations,
    IReadOnlyList<AppliedRepair> Repairs,
    int PageCount);
```

Only atomically rename the temporary output after `Passed` is true.

- [ ] **Step 4: Run tests with license/fonts**

Run the Step 2 command with `ASPOSE_LICENSE_PATH` and `RENDERER_FONT_DIR` already configured to the approved test assets.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add document-renderer/src/DocumentRenderer.Core/Editing document-renderer/src/DocumentRenderer.Core/Verification document-renderer/src/DocumentRenderer.Core/Contracts document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests
git commit -m "feat: enforce high-fidelity semantic DOCX rendering"
```

### Task 8: Connect Template Schemas, Owner-Scoped RAG, and Generated Documents

**Files:**
- Create: `backend/src/services/template_generation_service.ts`
- Create: `backend/src/services/template_generation_service.test.ts`
- Modify: `backend/src/services/structured_output_service.ts`
- Modify: `backend/src/services/document_profile_service.ts`
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/documents.ts`
- Modify: `backend/src/services/orchestrator.ts`
- Modify: `backend/src/routes/workflow.contract.test.ts`
- Modify: `backend/src/routes/documents.contract.test.ts`

**Interfaces:**
- `POST /api/workflow/stream` consumes `{ prompt: string, templateId: string, referenceDocumentIds?: string[] }`.
- Produces a user-owned `Document` row plus a verified `storageKey`; export streams that stored DOCX.

- [ ] **Step 1: Add failing generation-boundary tests**

Assert foreign/non-READY template IDs return 404/409, reference IDs are owner-filtered, the LLM receives the stored schema with `additionalProperties: false`, deterministic date/agency/location/document number values override model output, invalid JSON is retried once, the renderer sees only validated semantic values, and no `Document` becomes complete until fidelity passes. Assert `SHORTEN_REQUIRED` causes exactly one field-bounded regeneration.

- [ ] **Step 2: Run and observe failure**

Run: `cd backend && npx jest src/services/template_generation_service.test.ts src/routes/workflow.contract.test.ts src/routes/documents.contract.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement structured template generation**

```ts
export interface TemplateGenerationInput {
  ownerId: string;
  templateId: string;
  prompt: string;
  referenceDocumentIds?: string[];
  signal?: AbortSignal;
}

export interface TemplateGenerationResult {
  documentId: string;
  content: string;
  storageKey: string;
  outputSha256: string;
  fidelityReport: FidelityReport;
}
```

Load the template with `{ id, ownerId, status: READY }`; retrieve only owner-scoped references; pack evidence; generate semantic JSON against `generationSchema`; inject the system date, profile agency/place/recipient/signatory defaults, and one atomically reserved document number; validate; invoke renderer. Create the owner-linked document as `status='draft'` with `metadata.generation.state='rendering'`, then set its verified `storageKey`, output hash, and `metadata.generation.state='verified'` only after the fidelity gate passes; set the metadata state to `failed` on a terminal error. Export resolves `storageKey` beneath the configured upload root and returns only verified files.

- [ ] **Step 4: Rerun generation tests and backend build**

Run the Step 2 command followed by `cd backend && npm run build`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/template_generation_service.ts backend/src/services/template_generation_service.test.ts backend/src/services/structured_output_service.ts backend/src/services/document_profile_service.ts backend/src/routes/workflow.ts backend/src/routes/documents.ts backend/src/services/orchestrator.ts backend/src/routes/workflow.contract.test.ts backend/src/routes/documents.contract.test.ts
git commit -m "feat: generate verified documents from private templates"
```

### Task 9: Replace the Legacy Template Service in Docker

**Files:**
- Delete: `template-service/config.py`
- Delete: `template-service/generate_templates.py`
- Delete: `template-service/main.py`
- Delete: `template-service/requirements.txt`
- Delete: `template-service/Dockerfile`
- Delete tracked generated files: `templates/*.docx`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `.gitignore`
- Create: `document-renderer/README.md`

**Interfaces:**
- Produces private Compose service `document-renderer:8080` and named volume `template_storage` mounted at `/data/templates` in backend and renderer.

- [ ] **Step 1: Add a Compose contract assertion**

Extend the backend removed-surface test or create `ops/test-compose.ps1` to parse `docker compose config --format json` and assert: no `template-service`, no `lora`, renderer has no `ports`, backend and renderer share `template_storage`, and both have `TEMPLATE_STORAGE_DIR=/data/templates`.

- [ ] **Step 2: Run and observe legacy service/static mount failure**

Run: `pwsh -File ops/test-compose.ps1`

Expected: FAIL.

- [ ] **Step 3: Replace Compose service and retire generated templates**

Configure renderer healthcheck against `/ready`, `expose: [8080]`, `ASPOSE_LICENSE_PATH=/run/secrets/aspose-license.lic`, read-only license/font mounts, `RENDERER_SERVICE_TOKEN`, and shared storage. Backend gets `DOCUMENT_RENDERER_URL=http://document-renderer:8080`, the same token, and volume. Remove `./templates:/app/templates`. Ignore local `fonts/`, `licenses/`, and generated template storage; do not commit proprietary assets.

- [ ] **Step 4: Verify Compose and both service builds**

Run: `pwsh -File ops/test-compose.ps1`; `docker compose config --quiet`; `docker compose build document-renderer backend`.

Expected: PASS/build success. Do not run `docker compose up` against live service names.

- [ ] **Step 5: Commit**

```bash
git add -A template-service templates document-renderer docker-compose.yml .env.example backend/.env.example .gitignore ops/test-compose.ps1
git commit -m "refactor: replace static templates with private renderer"
```
