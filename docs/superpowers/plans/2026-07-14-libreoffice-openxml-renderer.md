# LibreOffice + Open XML Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Aspose.Words with a fully free/open-source LibreOffice + Poppler visual renderer while preserving Open XML as the authoritative DOCX editor and returning structurally valid documents with explicit fidelity warnings.

**Architecture:** The existing .NET renderer continues to validate, analyze, fingerprint, and edit DOCX packages with Open XML. New focused components run LibreOffice headlessly against disposable copies, rasterize the resulting PDF with Poppler, inspect font substitutions through fontconfig, and assess page-level fidelity. Visual rendering failures become warnings after a structurally valid DOCX is atomically published; package, ownership, locator, and geometry failures remain fatal.

**Tech Stack:** .NET 10, ASP.NET Core minimal APIs, Open XML SDK 3.5.1, LibreOffice Writer 25.2.x from Debian 13, Poppler `pdftoppm`, fontconfig, Liberation/Carlito/Caladea/Noto fonts, xUnit, Node.js/TypeScript/Jest, Next.js 16/React 19/Vitest, Docker Compose.

## Global Constraints

- The renderer and every bundled runtime dependency must be free/open-source; no Aspose, Microsoft Word automation, Microsoft Graph, ONLYOFFICE, proprietary font bundle, or paid fallback may remain.
- LibreOffice may read disposable DOCX copies and export PDF, but it must never save or rewrite an authoritative DOCX.
- Open XML remains the only authoritative DOCX mutation path.
- A structurally valid DOCX remains downloadable when visual validation fails, with stable machine-readable warnings.
- Unsafe packages, ownership/path violations, missing or duplicate locators, unexpected static-part changes, and floating-object geometry changes remain fatal.
- The renderer remains private on the Compose network and requires the existing constant-time internal token check.
- Every LibreOffice job uses a unique writable user profile and temporary directory, has bounded concurrency and timeout, honors cancellation, and removes temporary artifacts.
- Runtime package versions and the renderer image must be pinned and changed only with regression-corpus verification.
- Existing dirty worktree changes belong to the user. Stage and commit only files named by the current task.
- Execute this plan inline; do not spawn agents unless the user later explicitly authorizes them.

---

## File Structure

### Renderer files

- Modify `document-renderer/src/DocumentRenderer.Core/DocumentRenderer.Core.csproj` — remove Aspose; retain Open XML only.
- Modify `document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs` — executable, temporary-root, timeout, concurrency, DPI, and free-font options.
- Modify `document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs` — additive fidelity warning/status contract.
- Create `document-renderer/src/DocumentRenderer.Core/Processes/ProcessContracts.cs` — immutable process request/result types and runner interface.
- Create `document-renderer/src/DocumentRenderer.Core/Processes/ExternalProcessRunner.cs` — shell-free process execution, cancellation, timeout, and process-tree termination.
- Create `document-renderer/src/DocumentRenderer.Core/Rendering/IPageRenderer.cs` — page-renderer boundary.
- Create `document-renderer/src/DocumentRenderer.Core/Rendering/LibreOfficePageRenderer.cs` — isolated DOCX-to-PDF conversion.
- Create `document-renderer/src/DocumentRenderer.Core/Rendering/PopplerPageRasterizer.cs` — PDF-to-PNG conversion and numeric page discovery.
- Create `document-renderer/src/DocumentRenderer.Core/Rendering/FontInspector.cs` — DOCX font extraction and `fc-match` substitution reporting.
- Create `document-renderer/src/DocumentRenderer.Core/Rendering/FidelityAssessor.cs` — page count/dimension/font/overflow warnings.
- Create `document-renderer/src/DocumentRenderer.Core/Verification/DocumentIntegrityVerifier.cs` — fatal locator, shape-geometry, and immutable-package checks.
- Modify `document-renderer/src/DocumentRenderer.Core/Rendering/DocumentRenderEngine.cs` — use the new components and publish before non-fatal visual validation.
- Modify `document-renderer/src/DocumentRenderer.Core/Rendering/RendererReadiness.cs` — executable/font/storage/smoke readiness.
- Modify `document-renderer/src/DocumentRenderer.Api/Program.cs` — configure and inject new components.
- Modify `document-renderer/Dockerfile` — install LibreOffice Writer, Poppler, fontconfig, and free fonts.
- Modify `document-renderer/README.md` and `document-renderer/.dockerignore` — document and package the new runtime.

### Tests

- Modify `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs` — retain package/storage/Open XML regression tests and remove license assumptions.
- Create `document-renderer/tests/DocumentRenderer.Tests/ExternalProcessRunnerTests.cs`.
- Create `document-renderer/tests/DocumentRenderer.Tests/LibreOfficePageRendererTests.cs`.
- Create `document-renderer/tests/DocumentRenderer.Tests/FontInspectorTests.cs`.
- Create `document-renderer/tests/DocumentRenderer.Tests/FidelityAssessorTests.cs`.
- Create `document-renderer/tests/DocumentRenderer.Tests/BestEffortRenderTests.cs`.

### Backend and frontend

- Modify `backend/src/types/templates.ts` — TypeScript warning/status types.
- Modify `backend/src/services/template_service_client.ts` — additive response parsing and corrected contract documentation.
- Modify `backend/src/services/template_generation_service.ts` — accept structurally valid outputs with warnings and preserve the first valid result during optional shortening.
- Modify `backend/src/services/template_generation_service.test.ts` — best-effort and fatal-integrity regression tests.
- Modify `backend/src/routes/workflow.ts` and `backend/src/routes/workflow.contract.test.ts` — stream structured warnings on completion.
- Modify `backend/src/routes/documents.ts` and `backend/src/routes/documents.contract.test.ts` — expose stored fidelity metadata and allow verified-with-warning downloads.
- Modify `frontend/lib/api.ts` — warning/status response types.
- Create `frontend/components/feature/FidelityWarningPanel.tsx` — accessible warning summary.
- Modify `frontend/app/(app)/generate/page.tsx` — display completion state and warnings without blocking download.
- Modify `frontend/components/DocumentDetailModal.tsx` — display saved warnings for later downloads.
- Create `frontend/test/fidelity-warnings.test.tsx` and modify `frontend/test/smoke.test.tsx` where stream fixtures require the additive fields.

### Operations and documentation

- Modify `docker-compose.yml`, `.env.example`, `backend/.env.example`, `README.md`, and `docs/verification/phase-4-evidence.md`.
- Modify `ops/test-compose.ps1` — assert that proprietary mounts/configuration are absent and free renderer limits are present.
- Create `ops/test-renderer-container.ps1` — build and smoke-test the pinned container using the representative DOCX.
- Modify `ops/verify-all.ps1` — add an opt-in renderer-container gate.

---

### Task 1: Add the Open-Source Renderer Contracts Without Breaking the Current Engine

**Files:**
- Modify: `document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs`
- Modify: `document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Modify: `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs`

**Interfaces:**
- Produces: `FidelityWarning`, `FidelityValidationStatus`, extended `FidelityReport`, and LibreOffice process options consumed by all later tasks.

- [x] **Step 1: Replace the readiness test with a failing open-source-options test**

```csharp
[Fact]
public void OptionsExposeLibreOfficeProcessConfiguration()
{
    var properties = typeof(RendererOptions).GetProperties().Select(p => p.Name).ToArray();
    Assert.Contains("LibreOfficeExecutable", properties);
    Assert.Contains("PdfToPngExecutable", properties);
    Assert.Contains("TempRoot", properties);
}
```

- [x] **Step 2: Run the focused test and confirm the old contract fails**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter OptionsExposeLibreOfficeProcessConfiguration`

Expected: FAIL because `RendererOptions` lacks the new properties.

- [x] **Step 3: Replace renderer options with the exact contract**

```csharp
public sealed record RendererOptions
{
    public required string StorageRoot { get; init; }
    // Transitional members remain only until Task 5 switches the engine atomically.
    public required string AsposeLicensePath { get; init; }
    public required string FontDirectory { get; init; }
    public required string TempRoot { get; init; }
    public required string LibreOfficeExecutable { get; init; }
    public required string PdfToPngExecutable { get; init; }
    public required string FontMatchExecutable { get; init; }
    public required string[] RequiredFonts { get; init; }
    public required string ServiceToken { get; init; }
    public TimeSpan RenderTimeout { get; init; } = TimeSpan.FromSeconds(120);
    public int MaxConcurrentRenders { get; init; } = 2;
    public int PngDpi { get; init; } = 144;
    public int MaxRenderedPages { get; init; } = 100;
    public long MaxRenderedBytes { get; init; } = 256L * 1024 * 1024;
}
```

- [x] **Step 4: Extend fidelity types additively**

```csharp
public enum FidelityValidationStatus { Passed, Warnings, Unavailable }
public sealed record FidelityWarning(
    string Code,
    string Severity,
    string Message,
    string? Field = null,
    IReadOnlyDictionary<string, string>? Details = null);
public sealed record FidelityReport(
    bool Passed,
    IReadOnlyList<FidelityViolation> Violations,
    IReadOnlyList<AppliedRepair> Repairs,
    int PageCount,
    IReadOnlyList<FidelityWarning> Warnings,
    FidelityValidationStatus ValidationStatus)
{
    public FidelityReport(
        bool passed,
        IReadOnlyList<FidelityViolation> violations,
        IReadOnlyList<AppliedRepair> repairs,
        int pageCount)
        : this(passed, violations, repairs, pageCount, [], FidelityValidationStatus.Passed) { }
}
```

`Passed` means that visual checks found no warning; it is no longer the authority for download eligibility. `RenderDocumentResponse.Success` means that a structurally verified DOCX was published. Register `JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)` when Task 6 wires the API so the enum serializes as `passed`, `warnings`, or `unavailable`.

Add transitional initializers for the new required options to `Program.cs` using the same environment variable names and defaults specified in Task 6. Update the test `Options()` helper with harmless fake executable names and `_root` as `TempRoot`; do not change runtime behavior yet.

- [x] **Step 5: Keep the existing engine buildable during the contract transition**

Do not remove `Aspose.Words`, `AsposeLicensePath`, or `FontDirectory` in this task. They are removed atomically with the old renderer in Task 5. Run:

`C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln`

Expected: all existing renderer tests PASS with the additive contract.

- [x] **Step 6: Run the Release build**

Run: `C:\Users\PC\.dotnet10\dotnet.exe build document-renderer/DocumentRenderer.sln -c Release --no-restore`

Expected: PASS with 0 warnings and 0 errors.

- [x] **Step 7: Commit only the contract change**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs document-renderer/src/DocumentRenderer.Core/Contracts/RendererContracts.cs document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs
git commit -m "refactor: define open source renderer contracts"
```

### Task 2: Add Shell-Free External Process Execution

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Processes/ProcessContracts.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Processes/ExternalProcessRunner.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/ExternalProcessRunnerTests.cs`

**Interfaces:**
- Produces: `IExternalProcessRunner.RunAsync(ProcessRequest, CancellationToken)` for LibreOffice, Poppler, fontconfig, and readiness.

- [x] **Step 1: Write failing cancellation and argument-isolation tests**

```csharp
[Fact]
public void ProcessRequestStoresArgumentsWithoutACommandShell()
{
    var request = new ProcessRequest("soffice", ["--headless", "file name.docx"], "/tmp/job", TimeSpan.FromSeconds(5));
    Assert.Equal("file name.docx", request.Arguments[1]);
    Assert.DoesNotContain("sh", request.FileName, StringComparison.OrdinalIgnoreCase);
}

[Fact]
public async Task CancelledRequestDoesNotStartAProcess()
{
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
        new ExternalProcessRunner().RunAsync(
            new ProcessRequest("definitely-not-started", [], _root, TimeSpan.FromSeconds(1)),
            cancellation.Token));
}
```

- [x] **Step 2: Run the focused test**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter ExternalProcessRunnerTests`

Expected: FAIL because the process types do not exist.

- [x] **Step 3: Add immutable process contracts**

```csharp
public sealed record ProcessRequest(
    string FileName,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    TimeSpan Timeout,
    IReadOnlyDictionary<string, string>? Environment = null);
public sealed record ProcessResult(int ExitCode, string StandardOutput, string StandardError, bool TimedOut);
public interface IExternalProcessRunner
{
    Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken);
}
```

- [x] **Step 4: Implement direct process execution**

Use `ProcessStartInfo.UseShellExecute = false`, append every argument through `ArgumentList`, redirect both output streams, link request cancellation with `CancelAfter(request.Timeout)`, and call `process.Kill(entireProcessTree: true)` when the linked token fires. A timeout returns `TimedOut = true`; caller cancellation throws `OperationCanceledException`. Never include document contents or service secrets in exceptions.

- [x] **Step 5: Add a non-zero-exit regression test**

Use the current `dotnet` executable with the invalid argument `--definitely-invalid-option` and assert `ExitCode != 0`, `TimedOut == false`, and captured error/output is bounded to 16 KiB per stream.

- [x] **Step 6: Run tests and build**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter ExternalProcessRunnerTests`

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Processes document-renderer/tests/DocumentRenderer.Tests/ExternalProcessRunnerTests.cs
git commit -m "feat: add bounded renderer process runner"
```

### Task 3: Implement LibreOffice PDF Export and Poppler PNG Rendering

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/IPageRenderer.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/LibreOfficePageRenderer.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/PopplerPageRasterizer.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/LibreOfficePageRendererTests.cs`

**Interfaces:**
- Consumes: `IExternalProcessRunner`, `RendererOptions`.
- Produces: `IPageRenderer.RenderAsync(PageRenderRequest, CancellationToken)`.

- [x] **Step 1: Write failing tests for isolated profiles and deterministic pages**

```csharp
[Fact]
public async Task UsesDisposableCopyAndUniqueLibreOfficeProfile()
{
    var fake = new RecordingProcessRunner(CreateExpectedPdfAndPng);
    var renderer = CreateRenderer(fake);
    var result = await renderer.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-1"), default);
    var soffice = Assert.Single(fake.Requests, request => request.FileName == "soffice");
    Assert.Contains(soffice.Arguments, value => value.StartsWith("-env:UserInstallation=file://", StringComparison.Ordinal));
    Assert.DoesNotContain(_sourceDocx, soffice.Arguments);
    Assert.Equal(["page_0001.png", "page_0002.png"], result.PagePaths.Select(Path.GetFileName));
    Assert.Equal(_originalSha256, Sha256(_sourceDocx));
}
```

Also test that stale `page_*.png` files are removed, output page count over `MaxRenderedPages` fails, cumulative PDF/PNG bytes over `MaxRenderedBytes` fail, only `MaxConcurrentRenders` jobs enter the process runner at once, and no temporary profile remains after a simulated conversion failure.

- [x] **Step 2: Run the focused tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter LibreOfficePageRendererTests`

Expected: FAIL because page rendering interfaces do not exist.

- [x] **Step 3: Add the page renderer contracts**

```csharp
public sealed record PageRenderRequest(string SourceDocx, string OutputDirectory, string JobId);
public sealed record PageRenderResult(IReadOnlyList<string> PagePaths);
public interface IPageRenderer
{
    Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken);
}
public sealed class PageRenderException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
```

- [x] **Step 4: Implement Poppler rasterization**

Invoke:

```text
pdftoppm -png -r <PngDpi> <job.pdf> <jobDir/page>
```

Accept only regular files matching `page-[0-9]+.png` inside the job directory, sort by numeric suffix, reject zero pages or more than `MaxRenderedPages`, and atomically copy them as `page_0001.png`, `page_0002.png`, and so on.

- [x] **Step 5: Implement LibreOffice conversion**

Invoke the configured executable with these distinct arguments:

```text
--headless
--nologo
--nodefault
--nolockcheck
--norestore
-env:UserInstallation=file:///tmp/renderer/job-<random>/profile
--convert-to
pdf:writer_pdf_Export
--outdir
<job-dir>
<disposable-docx-copy>
```

Create the job directory beneath `TempRoot` using a server-generated GUID, copy the source under a fixed `input.docx` name, verify a single non-empty `input.pdf`, delegate to Poppler, then delete the whole job directory in `finally`.

Wrap the complete copy → LibreOffice → Poppler → publication operation in a singleton `SemaphoreSlim(options.MaxConcurrentRenders)`. Reject cumulative PDF plus PNG output greater than `MaxRenderedBytes` before copying previews to persistent storage.

- [x] **Step 6: Run focused and full renderer tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln`

Expected: page-renderer tests PASS; engine/readiness tests may remain red until Tasks 5–6.

- [x] **Step 7: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Rendering/IPageRenderer.cs document-renderer/src/DocumentRenderer.Core/Rendering/LibreOfficePageRenderer.cs document-renderer/src/DocumentRenderer.Core/Rendering/PopplerPageRasterizer.cs document-renderer/tests/DocumentRenderer.Tests/LibreOfficePageRendererTests.cs
git commit -m "feat: render DOCX pages with LibreOffice and Poppler"
```

### Task 4: Detect Font Substitutions and Produce Fidelity Warnings

**Files:**
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/FontInspector.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Rendering/FidelityAssessor.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/FontInspectorTests.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/FidelityAssessorTests.cs`

**Interfaces:**
- Consumes: Open XML package path, `IExternalProcessRunner`, baseline/generated page paths.
- Produces: `FontInspectionResult` and `FidelityAssessment`.

- [x] **Step 1: Write failing font extraction tests**

Create a synthetic DOCX with theme font `Times New Roman`, style font `Arial`, and run font `Calibri`; assert normalized, distinct extraction:

```csharp
Assert.Equal(["Arial", "Calibri", "Times New Roman"], inspector.ExtractDeclaredFonts(path));
```

Use a fake `fc-match` result that maps `Times New Roman` to `Liberation Serif`; assert a `FONT_SUBSTITUTED` warning with severity `warning` and details `{ requested: "Times New Roman", resolved: "Liberation Serif" }`.

- [x] **Step 2: Write failing fidelity tests**

```csharp
[Fact]
public void PageGrowthProducesHighWarningAndBoundedShortenRequest()
{
    var result = assessor.Assess(new FidelityAssessmentInput(
        BaselinePages: [Png(100, 100)],
        GeneratedPages: [Png(100, 100), Png(100, 100)],
        FontWarnings: [],
        Values: new Dictionary<string, string> { ["subject"] = new('x', 100) },
        Mappings: [new FieldLocator("subject", "main/p[1]")]));
    Assert.Contains(result.Warnings, warning => warning.Code == "PAGE_COUNT_CHANGED" && warning.Severity == "high");
    Assert.Equal(new ShortenRequest("subject", 80), result.ShortenRequired);
}
```

Also test page-dimension changes, no-warning status, and validation-unavailable status.

- [x] **Step 3: Run tests and confirm red**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter "FontInspectorTests|FidelityAssessorTests"`

Expected: FAIL because both components are absent.

- [x] **Step 4: Implement font inspection**

Read theme, styles, numbering, main document, headers, footers, footnotes, and endnotes through Open XML. Collect `Ascii`, `HighAnsi`, `EastAsia`, and `ComplexScript` font declarations. For each family call:

```text
fc-match --format=%{family}\n <family>
```

Treat the first normalized family as the resolved font. Missing or different resolution creates `FONT_SUBSTITUTED`; command failure creates `FONT_VALIDATION_UNAVAILABLE`.

- [x] **Step 5: Implement deterministic fidelity assessment**

Read PNG width/height from the validated PNG IHDR header without another image library. Emit:

- `PAGE_COUNT_CHANGED` when counts differ.
- `PAGE_DIMENSIONS_CHANGED` when corresponding dimensions differ.
- Existing font warnings.
- `RENDER_VALIDATION_UNAVAILABLE` when page rendering failed.
- `POSSIBLE_OVERFLOW` plus the existing 80% bounded `ShortenRequest` when page count grows.

Set `ValidationStatus` to `Unavailable` if rendering is unavailable, `Warnings` if any warning exists, otherwise `Passed`. Set `FidelityReport.Passed` only for `Passed`.

- [x] **Step 6: Run tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter "FontInspectorTests|FidelityAssessorTests"`

Expected: PASS.

- [x] **Step 7: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Rendering/FontInspector.cs document-renderer/src/DocumentRenderer.Core/Rendering/FidelityAssessor.cs document-renderer/tests/DocumentRenderer.Tests/FontInspectorTests.cs document-renderer/tests/DocumentRenderer.Tests/FidelityAssessorTests.cs
git commit -m "feat: report free-font and layout fidelity warnings"
```

### Task 5: Integrate Best-Effort Visual Validation Without Weakening Structural Safety

**Files:**
- Modify: `document-renderer/src/DocumentRenderer.Core/Rendering/DocumentRenderEngine.cs`
- Create: `document-renderer/src/DocumentRenderer.Core/Verification/DocumentIntegrityVerifier.cs`
- Modify: `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs`
- Create: `document-renderer/tests/DocumentRenderer.Tests/BestEffortRenderTests.cs`

**Interfaces:**
- Consumes: `IPageRenderer`, `FontInspector`, `FidelityAssessor`.
- Produces: structurally authoritative `RenderDocumentResponse` with additive warnings.

- [x] **Step 1: Write a failing best-effort render test**

Use a fake page renderer that throws `new PageRenderException("RENDER_TIMEOUT", "render timed out")`. Generate into the synthetic floating-VML fixture and assert:

```csharp
Assert.True(response.Success);
Assert.NotNull(response.OutputRelativePath);
Assert.Matches("^[a-f0-9]{64}$", response.OutputSha256!);
Assert.Equal(FidelityValidationStatus.Unavailable, response.FidelityReport.ValidationStatus);
Assert.Contains(response.FidelityReport.Warnings, warning => warning.Code == "RENDER_TIMEOUT");
Assert.True(File.Exists(Path.Combine(_root, response.OutputRelativePath!)));
```

- [x] **Step 2: Write failing structural-integrity tests**

Create `DocumentIntegrityVerifier` tests that compare two analyses where a VML shape coordinate has changed and assert `DocumentIntegrityException` with `SHAPE_GEOMETRY_CHANGED`. Add missing-locator and changed-static-part cases. At engine level, use an invalid requested locator and assert no final DOCX is published and a previous valid output remains untouched.

- [x] **Step 3: Run the focused tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter BestEffortRenderTests`

Expected: FAIL because the current engine renders before publishing and returns `success=false` for visual failures.

- [x] **Step 4: Refactor analysis rendering**

Replace `RenderPages` with `IPageRenderer.RenderAsync`. Analysis remains strict: baseline or labeled rendering failure propagates as a retryable analysis failure because templates cannot become READY without visual mapping evidence. Keep original SHA-256 verification before and after both renders.

- [x] **Step 5: Refactor generation ordering**

Use this exact sequence:

1. Validate owner path and package.
2. Copy to a unique output-side temporary file.
3. Insert mapped values.
4. Analyze before/after and enforce locator/shape fingerprints.
5. Verify immutable package parts.
6. Validate the temporary DOCX package again.
7. Atomically move temporary DOCX to the final output path.
8. Hash and stat the final output.
9. Inspect fonts and attempt visual rendering from a disposable copy.
10. Return `Success = true` with warnings even if step 9 fails.

Structural violations must throw `DocumentIntegrityException` before step 7. Do not convert them into fidelity warnings.

Move `VerifyStructure`, `VerifyStaticPackageParts`, `IsEditableXmlPart`, and `HashEntry` from the engine into `DocumentIntegrityVerifier.VerifyOrThrow(originalPath, outputPath, before, after, insertionViolations)`. This makes every fatal integrity branch directly testable.

- [x] **Step 6: Preserve bounded shortening as advisory**

When page growth is detected, return `Success = true`, the valid output path/hash/size, warnings, and `ShortenRequired`. A later retry may overwrite the output only after its own structural checks pass.

- [x] **Step 7: Run all renderer tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln`

Expected: PASS, including representative DOCX source-hash and floating-shape tests.

- [x] **Step 8: Remove the proprietary dependency atomically**

Delete the `Aspose.Words` package reference and transitional `AsposeLicensePath`/`FontDirectory` options after all engine references have been replaced. Run:

`rg -n "Aspose" document-renderer/src document-renderer/tests -g '!**/bin/**' -g '!**/obj/**'`

Expected: no matches.

- [x] **Step 9: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/DocumentRenderer.Core.csproj document-renderer/src/DocumentRenderer.Core/Configuration/RendererOptions.cs document-renderer/src/DocumentRenderer.Core/Rendering/DocumentRenderEngine.cs document-renderer/src/DocumentRenderer.Core/Verification/DocumentIntegrityVerifier.cs document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs document-renderer/tests/DocumentRenderer.Tests/BestEffortRenderTests.cs
git commit -m "feat: return structurally valid DOCX with fidelity warnings"
```

### Task 6: Replace License Readiness with Executable, Font, and Smoke Readiness

**Files:**
- Modify: `document-renderer/src/DocumentRenderer.Core/Rendering/RendererReadiness.cs`
- Modify: `document-renderer/src/DocumentRenderer.Api/Program.cs`
- Modify: `document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs`

**Interfaces:**
- Consumes: `RendererOptions`, `IExternalProcessRunner`, `IPageRenderer`.
- Produces: `/ready` status with stable, non-sensitive error codes.

- [x] **Step 1: Write failing readiness tests**

Assert missing token, unavailable `soffice`, unavailable `pdftoppm`, unresolved required free fonts, unwritable storage/temp roots, and failed bundled smoke conversion each yield stable codes. Assert no error contains a filesystem path, command output, or document content.

- [x] **Step 2: Run readiness tests**

Run: `C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln --filter Readiness`

Expected: FAIL against the Aspose license checks.

- [x] **Step 3: Parse environment configuration in `Program.cs`**

Use:

```csharp
TempRoot = Environment.GetEnvironmentVariable("RENDERER_TEMP_ROOT") ?? "/tmp/document-renderer",
LibreOfficeExecutable = Environment.GetEnvironmentVariable("LIBREOFFICE_PATH") ?? "soffice",
PdfToPngExecutable = Environment.GetEnvironmentVariable("PDFTOPPM_PATH") ?? "pdftoppm",
FontMatchExecutable = Environment.GetEnvironmentVariable("FC_MATCH_PATH") ?? "fc-match",
RenderTimeout = TimeSpan.FromSeconds(ParseBoundedInt("RENDERER_RENDER_TIMEOUT_SECONDS", 120, 10, 300)),
MaxConcurrentRenders = ParseBoundedInt("RENDERER_MAX_CONCURRENT_RENDERS", 2, 1, 8),
PngDpi = ParseBoundedInt("RENDERER_PNG_DPI", 144, 72, 300),
MaxRenderedPages = ParseBoundedInt("RENDERER_MAX_RENDERED_PAGES", 100, 1, 500),
MaxRenderedBytes = ParseBoundedLong("RENDERER_MAX_RENDERED_BYTES", 268_435_456, 1_048_576, 536_870_912),
```

Register one singleton `ExternalProcessRunner`, `PopplerPageRasterizer`, `IPageRenderer`, `FontInspector`, `FidelityAssessor`, readiness service, and engine.

Also register `new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower)` in `ConfigureHttpJsonOptions`; retain snake-case property naming so `ValidationStatus` becomes `validation_status: "warnings"` instead of a numeric enum.

- [x] **Step 4: Implement cached smoke readiness**

Readiness runs at startup and caches for 60 seconds. It checks `soffice --version`, `pdftoppm -v`, `fc-match` for every required free family, writable storage/temp roots, and conversion of a bundled one-page smoke DOCX to PNG. Return only codes such as `TOKEN_UNSAFE`, `LIBREOFFICE_UNAVAILABLE`, `POPPLER_UNAVAILABLE`, `FONT_UNAVAILABLE`, `STORAGE_UNWRITABLE`, and `SMOKE_RENDER_FAILED`.

- [x] **Step 5: Run renderer tests and Release build**

```powershell
C:\Users\PC\.dotnet10\dotnet.exe test document-renderer/DocumentRenderer.sln
C:\Users\PC\.dotnet10\dotnet.exe build document-renderer/DocumentRenderer.sln -c Release --no-restore
```

Expected: all tests PASS; build has 0 warnings and 0 errors.

- [x] **Step 6: Commit**

```powershell
git add document-renderer/src/DocumentRenderer.Core/Rendering/RendererReadiness.cs document-renderer/src/DocumentRenderer.Api/Program.cs document-renderer/tests/DocumentRenderer.Tests/RendererCoreTests.cs
git commit -m "feat: make LibreOffice renderer readiness fail closed"
```

### Task 7: Accept and Persist Best-Effort Fidelity Warnings in the Backend

**Files:**
- Modify: `backend/src/types/templates.ts`
- Modify: `backend/src/services/template_service_client.ts`
- Modify: `backend/src/services/template_generation_service.ts`
- Modify: `backend/src/services/template_generation_service.test.ts`
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/workflow.contract.test.ts`
- Modify: `backend/src/routes/documents.ts`
- Modify: `backend/src/routes/documents.contract.test.ts`

**Interfaces:**
- Consumes: renderer `fidelity_report.warnings` and `validation_status`.
- Produces: stored generation metadata and SSE completion warnings.

- [x] **Step 1: Replace the old hard-failure test with failing best-effort tests**

Test that `success=true`, valid path/hash, `passed=false`, and `validationStatus='warnings'` stores the deliverable as verified and returns warnings. Add a separate test where `success=false` or path/hash is invalid and assert the document remains failed with no storage key.

- [x] **Step 2: Test shortening fallback**

Make the first render structurally valid with `shorten_required`, then make the shortening model call or second render fail. Assert the first output remains the selected deliverable with its warnings rather than being discarded.

- [x] **Step 3: Run focused backend tests**

Run: `npm test -- --runInBand src/services/template_generation_service.test.ts src/routes/workflow.contract.test.ts src/routes/documents.contract.test.ts`

Workdir: `backend`

Expected: FAIL under the existing `fidelity_report.passed` requirement.

- [x] **Step 4: Add exact TypeScript warning types**

```typescript
export type FidelityValidationStatus = 'passed' | 'warnings' | 'unavailable';
export interface FidelityWarning {
  code: string;
  severity: 'info' | 'warning' | 'high';
  message: string;
  field?: string;
  details?: Record<string, string>;
}
export interface FidelityReport {
  passed: boolean;
  violations: Array<{ code: string; field?: string; message: string }>;
  repairs: Array<{ policy: string; field: string }>;
  pageCount: number;
  warnings: FidelityWarning[];
  validationStatus: FidelityValidationStatus;
}
```

Normalize snake-case renderer fields in one client function; do not let `any` leak beyond that boundary.

- [x] **Step 5: Change deliverable eligibility**

Require only:

```typescript
const deliverableValid = rendered.success
  && rendered.output_relative_path === expectedPath
  && /^[a-f0-9]{64}$/i.test(rendered.output_sha256 ?? '')
  && Number.isSafeInteger(rendered.output_size)
  && (rendered.output_size ?? 0) > 0;
```

Persist `state: 'verified'`, `validationStatus`, and the full sanitized fidelity report. Keep structural/renderer `success=false` fatal.

- [x] **Step 6: Make optional shortening preserve a valid first result**

Store `firstValidRender`. Attempt exactly one bounded shortening when requested. Replace it only with a second structurally valid render. If shortening fails, retain `firstValidRender` and append `SHORTENING_FAILED` with severity `warning`.

- [x] **Step 7: Stream and expose warnings**

The completion SSE event includes:

```typescript
{
  stage: 'complete',
  done: true,
  documentId,
  fidelity: { validationStatus, warnings }
}
```

Document detail responses expose the sanitized `metadata.generation.fidelityReport`; export still requires `state === 'verified'`, exact owner scope, stored path, and stored SHA-256.

- [x] **Step 8: Run backend gates**

```powershell
npm test -- --runInBand
npx prisma validate
npm run check-schema
npm run build
```

Workdir: `backend`

Expected: all pass.

- [x] **Step 9: Commit**

```powershell
git add backend/src/types/templates.ts backend/src/services/template_service_client.ts backend/src/services/template_generation_service.ts backend/src/services/template_generation_service.test.ts backend/src/routes/workflow.ts backend/src/routes/workflow.contract.test.ts backend/src/routes/documents.ts backend/src/routes/documents.contract.test.ts
git commit -m "feat: preserve DOCX deliverables with fidelity warnings"
```

### Task 8: Display Fidelity Warnings Without Blocking Download

**Files:**
- Modify: `frontend/lib/api.ts`
- Create: `frontend/components/feature/FidelityWarningPanel.tsx`
- Modify: `frontend/app/(app)/generate/page.tsx`
- Modify: `frontend/components/DocumentDetailModal.tsx`
- Create: `frontend/test/fidelity-warnings.test.tsx`
- Modify: `frontend/test/smoke.test.tsx`

**Interfaces:**
- Consumes: SSE `fidelity.validationStatus` and saved document generation metadata.
- Produces: accessible Vietnamese status/warning UI.

- [x] **Step 1: Write failing UI tests**

Render three reports and assert exact headings:

```typescript
expect(screen.getByText('Kiểm tra bố cục đã đạt')).toBeInTheDocument();
expect(screen.getByText('Đã tạo với cảnh báo bố cục')).toBeInTheDocument();
expect(screen.getByText('Đã tạo; không thể kiểm tra hình ảnh')).toBeInTheDocument();
```

For warning/unavailable states, assert the DOCX download button remains enabled, warning codes are not shown as raw unexplained strings, and the panel uses `role="status"` or `role="alert"` according to severity.

- [x] **Step 2: Run focused frontend tests**

Run: `npm test -- --run frontend/test/fidelity-warnings.test.tsx`

Workdir: `frontend`

Expected: FAIL because the component does not exist.

- [x] **Step 3: Add frontend fidelity types**

```typescript
export type FidelityValidationStatus = 'passed' | 'warnings' | 'unavailable';
export interface FidelityWarning {
  code: string;
  severity: 'info' | 'warning' | 'high';
  message: string;
  field?: string;
  details?: Record<string, string>;
}
export interface FidelitySummary {
  validationStatus: FidelityValidationStatus;
  warnings: FidelityWarning[];
}
```

Add optional `fidelity?: FidelitySummary` to `StreamChunk` and sanitized generation metadata to `DocumentDetail`.

- [x] **Step 4: Implement the warning panel**

Map known warning codes to concise Vietnamese explanations. Show requested/resolved font names for `FONT_SUBSTITUTED`, page counts for `PAGE_COUNT_CHANGED`, and retry guidance for unavailable validation. Unknown codes display the server's sanitized message. Never say “perfect,” “guaranteed,” or “Word-identical.”

- [x] **Step 5: Wire generation and document detail**

Store the fidelity summary from the completion SSE event. Render the panel above the export action when generation completes. In `DocumentDetailModal`, render stored warnings above the content and keep export enabled for all `verified` documents.

- [x] **Step 6: Run frontend gates**

```powershell
npm test -- --run
npm run lint
npm run build
```

Workdir: `frontend`

Expected: all pass with zero lint warnings.

- [x] **Step 7: Commit**

```powershell
git add frontend/lib/api.ts frontend/components/feature/FidelityWarningPanel.tsx 'frontend/app/(app)/generate/page.tsx' frontend/components/DocumentDetailModal.tsx frontend/test/fidelity-warnings.test.tsx frontend/test/smoke.test.tsx
git commit -m "feat: show non-blocking DOCX fidelity warnings"
```

### Task 9: Build and Harden the Free Renderer Container

**Files:**
- Modify: `document-renderer/Dockerfile`
- Create: `document-renderer/fixtures/readiness.docx`
- Modify: `document-renderer/.dockerignore`
- Modify: `document-renderer/README.md`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Modify: `README.md`
- Modify: `ops/test-compose.ps1`
- Create: `ops/test-renderer-container.ps1`
- Modify: `ops/verify-all.ps1`

**Interfaces:**
- Produces: private, health-checked renderer image containing only free runtime assets.

- [x] **Step 1: Add failing Compose contract assertions**

```powershell
$renderer = $config.services.'document-renderer'
if ($renderer.environment.ASPOSE_LICENSE_PATH) { throw 'Aspose configuration must be absent' }
if ($renderer.volumes | Where-Object { $_.source -match 'licenses|fonts' }) { throw 'Proprietary asset mounts must be absent' }
if ($renderer.environment.RENDERER_TEMP_ROOT -ne '/tmp/document-renderer') { throw 'Renderer temp root is not isolated' }
if ([int64]$renderer.deploy.resources.limits.memory -gt 3221225472) { throw 'Renderer memory limit exceeds 3 GiB' }
if (-not $config.networks.renderer_internal.internal) { throw 'Renderer network must block external egress' }
if ($renderer.networks.PSObject.Properties.Name -contains 'default') { throw 'Renderer must not join the default network' }
```

- [x] **Step 2: Run Compose tests and confirm red**

Run: `powershell -File ops/test-compose.ps1`

Expected: FAIL because Aspose configuration and license/font mounts remain.

- [x] **Step 3: Replace the runtime Docker layer**

Install with `--no-install-recommends`:

```text
curl
fontconfig
libreoffice-writer
poppler-utils
fonts-liberation
fonts-crosextra-carlito
fonts-crosextra-caladea
fonts-noto-core
```

Run `fc-cache -f`, remove apt lists, create `/tmp/document-renderer` owned by `$APP_UID`, and copy the committed one-page `document-renderer/fixtures/readiness.docx` into `/app/fixtures/readiness.docx`. Generate that fixture once with Open XML, verify it contains only `[Content_Types].xml`, package relationships, and a one-paragraph `word/document.xml`, and commit the resulting DOCX. Do not install Python, Java, ImageMagick, Ghostscript, proprietary fonts, or Aspose artifacts.

- [x] **Step 4: Harden Compose configuration**

Remove `ASPOSE_LICENSE_PATH`, `RENDERER_FONT_DIR`, license/font bind mounts, and the old proprietary default. Add:

```yaml
environment:
  RENDERER_TEMP_ROOT: /tmp/document-renderer
  RENDERER_REQUIRED_FONTS: ${RENDERER_REQUIRED_FONTS:-Liberation Serif,Liberation Sans,Carlito,Caladea,Noto Sans}
  RENDERER_RENDER_TIMEOUT_SECONDS: ${RENDERER_RENDER_TIMEOUT_SECONDS:-120}
  RENDERER_MAX_CONCURRENT_RENDERS: ${RENDERER_MAX_CONCURRENT_RENDERS:-2}
  RENDERER_PNG_DPI: ${RENDERER_PNG_DPI:-144}
  RENDERER_MAX_RENDERED_PAGES: ${RENDERER_MAX_RENDERED_PAGES:-100}
  RENDERER_MAX_RENDERED_BYTES: ${RENDERER_MAX_RENDERED_BYTES:-268435456}
tmpfs:
  - /tmp/document-renderer:size=512m,mode=1770
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
```

Set the renderer memory limit to 3 GiB and retain no host-published port. Add an `internal: true` network named `renderer_internal`; attach only the backend and renderer to it, keep the backend on the default network for its other dependencies, and do not attach the renderer to the default network. This prevents renderer egress while preserving its private backend API.

- [x] **Step 5: Add the container smoke script**

`ops/test-renderer-container.ps1` must:

1. Build `document-renderer`.
2. Start only a disposable renderer plus a disposable named template-storage volume under a `docai_renderer_test_*` project name.
3. Wait for `/ready` from inside the container.
4. Copy the representative DOCX into owner-scoped storage.
5. Call analyze with the internal token and exact SHA-256.
6. Assert baseline/labeled PNGs exist and source hash is unchanged.
7. Assert `find /app -iname '*Aspose*'` returns no files.
8. Remove the disposable project and volume in `finally`.

The script must reject any project name not beginning with `docai_renderer_test_`.

- [x] **Step 6: Add opt-in aggregate verification**

Extend `ops/verify-all.ps1` with `[switch]$IncludeRendererContainer` and call the smoke script only when set. Keep ordinary host tests independent of locally installed LibreOffice.

- [x] **Step 7: Update documentation and examples**

State that the renderer is fully open-source, list the free font substitutions, explain best-effort warnings, remove license/font-directory setup, and change the old “failed fidelity gate produces no file” and license readiness statements.

- [x] **Step 8: Run container and Compose verification**

```powershell
$env:DB_PASSWORD='verification-only-password'
$env:RENDERER_INTERNAL_TOKEN='verification-only-renderer-token-32-chars'
docker compose config --quiet
powershell -File ops/test-compose.ps1
powershell -File ops/test-renderer-container.ps1
```

Expected: all pass and leave zero `docai_renderer_test_*` containers, volumes, or projects.

- [x] **Step 9: Commit**

```powershell
git add document-renderer/Dockerfile document-renderer/.dockerignore document-renderer/README.md document-renderer/fixtures/readiness.docx docker-compose.yml .env.example backend/.env.example README.md ops/test-compose.ps1 ops/test-renderer-container.ps1 ops/verify-all.ps1
git commit -m "build: ship free LibreOffice DOCX renderer"
```

### Task 10: Run the Regression Corpus and Complete Integrated Verification

**Files:**
- Modify: `docs/verification/phase-4-evidence.md`
- Modify only if a gate identifies a defect: files already named by Tasks 1–9.

**Interfaces:**
- Consumes: complete repository and disposable renderer/cutover infrastructure.
- Produces: fresh evidence and a clean verification result.

- [x] **Step 1: Run the representative renderer corpus in the container**

Run: `powershell -File ops/test-renderer-container.ps1`

Expected: representative Vietnamese administrative DOCX baseline/labeled/generated rendering passes, source hash remains unchanged, and VML/DrawingML geometry fingerprints match.

- [x] **Step 2: Run full repository verification**

Run: `powershell -File ops/verify-all.ps1 -IncludeRendererContainer -IncludeCutoverRehearsal`

Expected: backend, frontend, renderer, Python, Compose, Pester, renderer-container smoke, disposable cutover rehearsal, audits, builds, and whitespace checks all pass.

Run `C:\Users\PC\.dotnet10\dotnet.exe list document-renderer/DocumentRenderer.sln package --vulnerable --include-transitive` and inspect the renderer image with the locally available Docker vulnerability scanner. Any high/critical finding is blocking; document lower findings with package, advisory, reachability, and mitigation.

- [x] **Step 3: Scan for proprietary renderer residue**

```powershell
$matches = rg -n -i "Aspose|ASPOSE_LICENSE|licensed renderer|licensed font" . --glob '!**/.git/**' --glob '!**/bin/**' --glob '!**/obj/**' --glob '!docs/superpowers/**'
if ($LASTEXITCODE -eq 0) { $matches; throw 'Proprietary renderer references remain' }
if ($LASTEXITCODE -ne 1) { throw 'Residue scan failed' }
```

Expected: no active-code, active-config, current-doc, or built-artifact matches. Historical plans/specs may retain factual history and are excluded.

- [x] **Step 4: Verify disposable cleanup and repository integrity**

```powershell
docker ps -a --filter 'name=docai_renderer_test_' --format '{{.Names}}'
docker volume ls --filter 'name=docai_renderer_test_' --format '{{.Name}}'
git diff --check
git status --short
```

Expected: no disposable renderer resources, no whitespace errors, and only intentional user/plan changes.

- [x] **Step 5: Refresh the evidence record**

Record exact test counts, image build/smoke results, dependency audits, cutover result, cleanup counts, and the honest limitation: LibreOffice plus free font substitutes cannot guarantee Microsoft Word-identical output for every arbitrary DOCX.

- [x] **Step 6: Commit verification evidence**

```powershell
git add docs/verification/phase-4-evidence.md
git commit -m "docs: verify LibreOffice renderer migration"
```

---

## Final Acceptance Checklist

- [x] No Aspose package, license file, environment variable, mount, documentation requirement, or built binary remains.
- [x] LibreOffice and Poppler run only through shell-free bounded process execution.
- [x] Every LibreOffice request has an isolated profile and disposable working directory.
- [x] Open XML is the only code that mutates authoritative DOCX output.
- [x] Template analysis still requires baseline and labeled visual evidence.
- [x] Generated DOCX files pass package, locator, static-part, and floating-geometry checks before publication.
- [x] Visual failures and likely layout differences return warnings without blocking a structurally valid download.
- [x] Backend stores and streams warning status safely.
- [x] Frontend explains warning status and keeps download available.
- [x] The renderer has no host-published port, no new privileges, no Linux capabilities, bounded memory, bounded tmpfs, timeout, concurrency, page count, and output paths.
- [x] Representative Vietnamese DOCX, synthetic VML, and synthetic DrawingML regression fixtures pass.
- [x] Full repository verification and disposable database cutover rehearsal pass.
