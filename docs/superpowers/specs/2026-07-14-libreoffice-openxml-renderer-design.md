# LibreOffice + Open XML Renderer Design

Date: 2026-07-14

Status: Approved direction; awaiting written-spec review

## Objective

Replace Aspose.Words with an entirely free/open-source rendering pipeline while preserving the existing private, owner-scoped template workflow. Open XML remains authoritative for inspecting and editing DOCX packages. LibreOffice renders temporary copies for previews and fidelity assessment but never saves or rewrites the generated DOCX.

The system returns a generated DOCX with explicit fidelity warnings when visual validation is incomplete or detects a likely layout difference. Package safety, tenant isolation, output integrity, and structural corruption remain fail-closed.

## Scope

This change will:

- Remove the Aspose.Words package, license configuration, readiness checks, documentation, and tests.
- Keep the .NET renderer, Open XML package validator, structural analyzer, semantic inserter, storage path isolation, private service token, and HTTP contracts.
- Add a LibreOffice headless DOCX-to-PDF renderer and a free PDF-to-PNG rasterizer.
- Bundle only free/open-source fonts and report substitutions or unavailable template fonts.
- Preserve template analysis, baseline pages, labeled candidate pages, generated previews, and structural fingerprints.
- Change visual-fidelity failures from hard generation failures into structured warnings where a structurally valid DOCX exists.

This change will not:

- Use LibreOffice to save DOCX files.
- Use Microsoft Word COM automation, Microsoft Graph, ONLYOFFICE, or a paid fallback.
- Promise pixel-identical Microsoft Word rendering for arbitrary DOCX files.
- Weaken DOCX package validation, path confinement, owner isolation, or atomic publication.

## Architecture

The renderer remains an internal ASP.NET Core service. The document pipeline is split into two independent responsibilities:

1. `OpenXmlDocumentPipeline` validates, fingerprints, analyzes, and mutates the DOCX package.
2. `IPageRenderer` creates disposable visual artifacts from a read-only copy of that package.

`LibreOfficePageRenderer` implements `IPageRenderer` by converting a temporary DOCX copy to PDF. `PopplerPageRasterizer` converts that PDF to numbered PNG pages at a fixed DPI. This interface keeps the layout engine replaceable without coupling document editing to LibreOffice.

The authoritative output is always the DOCX produced by the Open XML pipeline. PDF and PNG files are derived artifacts used for previews and warnings only.

## Components

### Open XML document pipeline

The existing package validation and semantic insertion remain in place. Before publication, the pipeline verifies:

- The package is still a valid non-macro DOCX.
- Static package parts that should not change retain their hashes.
- DrawingML and VML floating-object geometry fingerprints are unchanged.
- Every requested field was inserted at its exact structural locator.
- The output path remains confined to the authenticated owner's storage namespace.

Failure of any of these checks is an integrity error. No output is published because the renderer itself may have corrupted or misaddressed the document.

### LibreOffice process runner

Each render operation receives a unique temporary working directory and LibreOffice user profile. LibreOffice is invoked directly with an argument list, never through a shell, using headless, no-restore, no-logo, and isolated-profile options.

The runner:

- Copies the source DOCX into the job directory without modifying the source.
- Starts a new process with a bounded timeout and captured standard output/error.
- Kills the entire process tree on timeout or cancellation.
- Limits concurrent conversions with a process-wide semaphore.
- Confirms that the expected PDF was produced inside the job directory.
- Deletes the profile, DOCX copy, PDF, and intermediate files in a `finally` path.
- Never accepts user-controlled command-line options or output paths.

The container applies memory, process, and temporary-storage limits in addition to application-level timeout and concurrency controls.

### PDF page rasterizer

Poppler's `pdftoppm` converts the PDF to PNG pages at a pinned resolution and color mode. Output names are discovered only inside the job directory, sorted numerically, validated as PNG files, and atomically copied to the owner-scoped preview directory.

The renderer does not use ImageMagick, Ghostscript, or a shell pipeline.

### Font inspector

Font inspection extracts declared font families from the DOCX theme, styles, and runs. `fc-match` resolves each family inside the renderer container.

The image includes pinned free font packages, initially:

- Liberation Serif/Sans/Mono for Times New Roman, Arial, and Courier-compatible metrics.
- Carlito and Caladea for Calibri and Cambria-compatible metrics.
- Noto families for broad Unicode and Vietnamese glyph coverage.

If a declared family resolves to a substitute, generation continues and returns a `FONT_SUBSTITUTED` warning containing only normalized family names. Filesystem paths and host font details are not exposed.

### Fidelity assessor

The assessor compares the generated render with the stored template baseline and combines visual evidence with Open XML structural evidence. It reports:

- Baseline and generated page counts.
- Dimensions of corresponding page images.
- Structural floating-object fingerprint equality.
- Static package-part hash equality.
- Font substitutions.
- Significant visual change outside expected edited regions when reliable masks are available.
- Possible overflow when page count grows, a mapped text container exceeds its configured budget, or the final page changes unexpectedly.

Visual metrics are advisory because LibreOffice is not Microsoft Word. Structural integrity checks remain authoritative.

## Data Flow

### Template analysis

1. The backend authenticates the user and stores the uploaded DOCX under that owner's namespace.
2. The renderer validates and fingerprints the original package.
3. Open XML analysis enumerates structural candidates, including paragraphs, table cells, DrawingML text, and VML text.
4. LibreOffice renders an untouched temporary copy as baseline pages.
5. Open XML creates a temporary labeled clone; LibreOffice renders the clone as labeled pages.
6. The renderer verifies that the stored original hash did not change.
7. The backend continues semantic mapping and review using the existing API contracts.

If baseline rendering fails, template analysis remains retryable and cannot become READY because reliable visual mapping evidence is unavailable.

### Document generation

1. The backend resolves a READY owner-scoped template and structured values.
2. Open XML inserts values into a private working copy.
3. Mandatory structural and package checks run.
4. The structurally valid DOCX is moved atomically to its final owner-scoped path.
5. LibreOffice attempts to render a disposable copy of the output.
6. The fidelity assessor produces warnings and preview pages when available.
7. The backend returns the DOCX plus a structured fidelity report.

If visual rendering fails after step 4, the valid DOCX remains available with `RENDER_VALIDATION_UNAVAILABLE`. If structural verification fails before publication, generation fails and no document is returned.

## Warning Contract

Fidelity warnings use stable machine-readable codes:

- `FONT_SUBSTITUTED`
- `PAGE_COUNT_CHANGED`
- `PAGE_DIMENSIONS_CHANGED`
- `UNEXPECTED_VISUAL_CHANGE`
- `POSSIBLE_OVERFLOW`
- `RENDER_TIMEOUT`
- `RENDER_FAILED`
- `RENDER_VALIDATION_UNAVAILABLE`
- `BASELINE_UNAVAILABLE`

Each warning has a severity of `info`, `warning`, or `high`, a short user-facing message, and non-sensitive details. Warnings never claim that Microsoft Word will render identically.

The frontend displays the overall result as one of:

- `Layout checks passed`
- `Generated with layout warnings`
- `Generated; visual validation unavailable`

Downloads remain available for all three outcomes when structural integrity passed.

## Error Handling

Fatal errors:

- Unsafe, malformed, encrypted, macro-enabled, externally linked, oversized, or path-traversing package.
- Owner/path mismatch.
- Missing structural locator or duplicate insertion target.
- Changed floating-object geometry caused by generation.
- Unexpected static package-part mutation.
- Invalid output DOCX or failed atomic publication.

Non-fatal warning conditions after a valid DOCX exists:

- LibreOffice or PDF rasterization timeout/failure.
- Font substitution.
- Page-count or page-dimension change.
- Possible content overflow or significant visual difference.
- Missing baseline preview.

Cancellation stops subprocesses and removes temporary artifacts. It does not delete an output that was already atomically published and structurally verified.

## Security and Isolation

- The renderer remains private to the Compose network with no published host port.
- Existing constant-time service-token validation remains mandatory.
- Job identifiers and paths are generated server-side.
- LibreOffice runs as an unprivileged user with a unique profile per request.
- The container has no need for internet access at runtime.
- Input files are copied into bounded temporary storage and validated before LibreOffice sees them.
- Concurrency, process lifetime, output size, page count, and temporary disk usage are bounded.
- Derived previews remain owner-scoped and are served only through authenticated backend routes.

## Readiness

`/ready` succeeds only when:

- The internal service token is securely configured.
- Storage and temporary directories are writable.
- LibreOffice Writer starts and reports the pinned expected major version.
- `pdftoppm` is available.
- Fontconfig is available and the required free font families resolve.
- A small bundled smoke DOCX converts to a non-empty PDF and PNG within the readiness timeout.

Readiness no longer depends on a license file or proprietary fonts.

## Container and Configuration Changes

The runtime image installs pinned LibreOffice Writer, Poppler utilities, fontconfig, and approved free fonts. Package versions and the base-image digest are pinned where practical.

Removed configuration:

- `ASPOSE_LICENSE_PATH`
- Aspose license volume mounts and documentation.

Retained or added configuration:

- `RENDERER_STORAGE_ROOT`
- `RENDERER_SERVICE_TOKEN`
- `RENDERER_REQUIRED_FONTS`
- `RENDERER_RENDER_TIMEOUT_SECONDS`
- `RENDERER_MAX_CONCURRENT_RENDERS`
- `RENDERER_PNG_DPI`
- `RENDERER_TEMP_ROOT`

## Testing Strategy

### Unit tests

- Safe process argument construction and path confinement.
- Isolated profile creation and cleanup.
- Timeout, cancellation, process-tree termination, and concurrency limiting.
- Font extraction, substitution detection, and warning serialization.
- Numeric page ordering and PNG validation.
- Fatal-versus-warning result semantics.

### Integration tests

- Convert a synthetic DOCX to PDF and PNG in the renderer container.
- Render baseline and labeled clones and verify that the original hash is unchanged.
- Generate a document with VML and DrawingML floating text boxes and verify geometry fingerprints remain equal.
- Simulate missing fonts, LibreOffice failure, rasterizer failure, and timeout; confirm that a structurally valid DOCX is returned with warnings.
- Confirm that malformed or unsafe packages still fail closed.
- Confirm owner-scoped storage and private endpoint authentication.

### Regression corpus

Use representative Vietnamese administrative documents containing:

- Two-column government headers.
- Dates, document numbers, sender/receiver blocks, signatures, and page numbers.
- Nested tables.
- VML and DrawingML floating text boxes.
- Multi-page text flow and content near page boundaries.

Store approved baseline PDFs or page images separately from runtime rendering. Where Microsoft Word reference exports are available, compare both the original template and generated samples against those references. Reference assets are test fixtures, not runtime dependencies.

### Repository gates

- All .NET, backend, frontend, Python, and operations tests pass.
- Renderer Release build has no warnings or errors.
- Backend and renderer Docker images build.
- Compose configuration and private-network contract pass.
- No Aspose package, environment variable, license mount, documentation requirement, or runtime reference remains.
- Dependency and container vulnerability scans are reviewed.
- `git diff --check` passes.

## Migration and Rollback

The backend-renderer HTTP request shapes remain compatible. Response fidelity data is extended additively with warnings so existing owner-scoped records and templates require no database migration.

Deployment replaces only the renderer image and backend/frontend consumers of the warning contract. Existing generated DOCX files and template baselines remain untouched. Rollback is an image/configuration rollback; it does not require database changes.

## Acceptance Criteria

- The repository contains no Aspose dependency or license requirement.
- Every authoritative DOCX mutation is performed through Open XML.
- LibreOffice never saves an authoritative DOCX.
- Baseline, labeled, and generated previews are produced through LibreOffice and Poppler.
- Floating DrawingML/VML geometry remains structurally unchanged after generation.
- A valid generated DOCX remains downloadable when visual validation fails, with an explicit fidelity warning.
- Unsafe packages, ownership violations, invalid locators, and structural corruption remain fatal.
- The representative DOCX regression corpus passes in the pinned container.
- The UI communicates warnings without claiming perfect Microsoft Word fidelity.
