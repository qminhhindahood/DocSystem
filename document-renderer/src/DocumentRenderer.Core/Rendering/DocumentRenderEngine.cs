using System.Security.Cryptography;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Editing;
using DocumentRenderer.Core.Security;
using DocumentRenderer.Core.Verification;

namespace DocumentRenderer.Core.Rendering;

public sealed class DocumentRenderEngine(
    RendererOptions options,
    StoragePathResolver paths,
    DocxPackageValidator validator,
    StructuralAnalyzer analyzer,
    SemanticInserter inserter,
    DocumentIntegrityVerifier integrityVerifier,
    IPageRenderer pageRenderer,
    FontInspector fontInspector,
    FidelityAssessor fidelityAssessor)
{
    public async Task<AnalyzeDocumentResponse> AnalyzeAsync(AnalyzeDocumentRequest request, CancellationToken cancellationToken)
    {
        ValidateId(request.TemplateId, nameof(request.TemplateId));
        if (!request.RelativePath.EndsWith($"/{request.TemplateId}.docx", StringComparison.Ordinal))
            throw new InvalidOperationException("Template path and identifier do not match");
        var original = paths.ResolveExisting(request.RelativePath);
        var package = await validator.ValidateAsync(original, cancellationToken);
        if (!package.Valid) throw new PackageRejectedException(package.Code);
        if (!CryptographicOperations.FixedTimeEquals(
            Convert.FromHexString(package.Sha256), Convert.FromHexString(request.Sha256)))
            throw new InvalidOperationException("Template hash does not match immutable original");

        var analysis = analyzer.Analyze(original);
        var baselineRelative = $"previews/{request.TemplateId}/baseline";
        var labeledRelative = $"previews/{request.TemplateId}/labeled";
        var baseline = await pageRenderer.RenderAsync(
            new PageRenderRequest(original, OutputDirectory(baselineRelative), $"analysis-{request.TemplateId}-baseline"),
            cancellationToken);
        var labeledCopy = paths.ResolveOutput($"{labeledRelative}/labeled.docx.tmp");
        File.Copy(original, labeledCopy, false);
        PageRenderResult labeled;
        try
        {
            ApplyCandidateLabels(labeledCopy, analysis.Candidates);
            labeled = await pageRenderer.RenderAsync(
                new PageRenderRequest(labeledCopy, OutputDirectory(labeledRelative), $"analysis-{request.TemplateId}-labeled"),
                cancellationToken);
        }
        finally
        {
            if (File.Exists(labeledCopy)) File.Delete(labeledCopy);
        }

        await using var immutableCheck = File.OpenRead(original);
        var finalHash = Convert.ToHexString(await SHA256.HashDataAsync(immutableCheck, cancellationToken)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(package.Sha256), Convert.FromHexString(finalHash)))
            throw new InvalidOperationException("Template changed during analysis");
        return new(
            true,
            analysis.DocumentFingerprint,
            analysis.Candidates,
            RelativePages(baseline.PagePaths),
            RelativePages(labeled.PagePaths),
            analysis.Compatibility);
    }

    public async Task<RenderDocumentResponse> RenderAsync(RenderDocumentRequest request, CancellationToken cancellationToken)
    {
        ValidateId(request.TemplateId, nameof(request.TemplateId));
        ValidateId(request.OwnerId, nameof(request.OwnerId));
        ValidateId(request.DocumentId, nameof(request.DocumentId));
        var expectedOriginal = $"originals/{request.OwnerId}/{request.TemplateId}.docx";
        if (!string.Equals(request.RelativePath, expectedOriginal, StringComparison.Ordinal))
            throw new InvalidOperationException("Template is outside the requested owner scope");
        var original = paths.ResolveExisting(request.RelativePath);
        var package = await validator.ValidateAsync(original, cancellationToken);
        if (!package.Valid) throw new PackageRejectedException(package.Code);

        var outputRelative = $"generated/{request.OwnerId}/{request.DocumentId}.docx";
        var output = paths.ResolveOutput(outputRelative);
        var temporary = output + $".{Guid.NewGuid():N}.tmp";
        File.Copy(original, temporary, false);
        try
        {
            var before = analyzer.Analyze(original);
            var insertionViolations = inserter.Insert(temporary, request.Values, request.Mappings);
            var after = analyzer.Analyze(temporary);
            integrityVerifier.VerifyOrThrow(original, temporary, before, after, insertionViolations);

            var generatedPackage = await validator.ValidateAsync(temporary, cancellationToken);
            if (!generatedPackage.Valid)
                throw new DocumentIntegrityException(generatedPackage.Code, "Generated DOCX package failed validation");

            File.Move(temporary, output, overwrite: true);
            await using var outputStream = File.OpenRead(output);
            var outputHash = Convert.ToHexString(await SHA256.HashDataAsync(outputStream, cancellationToken)).ToLowerInvariant();
            var outputSize = new FileInfo(output).Length;

            var fontWarnings = await InspectFontsBestEffort(output, cancellationToken);
            var assessment = await AssessVisualFidelityBestEffort(request, output, fontWarnings, cancellationToken);
            return new(
                true,
                outputRelative,
                outputHash,
                outputSize,
                assessment.Report,
                assessment.ShortenRequired);
        }
        finally
        {
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private async Task<IReadOnlyList<FidelityWarning>> InspectFontsBestEffort(
        string output,
        CancellationToken cancellationToken)
    {
        try
        {
            return (await fontInspector.InspectAsync(output, cancellationToken)).Warnings;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return [new FidelityWarning(
                "FONT_VALIDATION_UNAVAILABLE",
                "warning",
                "Font availability could not be verified.")];
        }
    }

    private async Task<FidelityAssessment> AssessVisualFidelityBestEffort(
        RenderDocumentRequest request,
        string output,
        IReadOnlyList<FidelityWarning> fontWarnings,
        CancellationToken cancellationToken)
    {
        var baselineDirectory = Path.Combine(options.StorageRoot, "previews", request.TemplateId, "baseline");
        var baselinePages = Directory.Exists(baselineDirectory)
            ? Directory.EnumerateFiles(baselineDirectory, "page_*.png").OrderBy(path => path, StringComparer.Ordinal).ToArray()
            : [];
        try
        {
            var renderedDirectory = $"previews/{request.TemplateId}/generated/{request.DocumentId}";
            var rendered = await pageRenderer.RenderAsync(
                new PageRenderRequest(output, OutputDirectory(renderedDirectory), $"generation-{request.DocumentId}"),
                cancellationToken);
            return fidelityAssessor.Assess(new FidelityAssessmentInput(
                baselinePages,
                rendered.PagePaths,
                fontWarnings,
                StringValues(request.Values),
                request.Mappings));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (PageRenderException error)
        {
            return fidelityAssessor.Assess(new FidelityAssessmentInput(
                baselinePages, [], fontWarnings, StringValues(request.Values), request.Mappings, error.Code));
        }
        catch
        {
            return fidelityAssessor.Assess(new FidelityAssessmentInput(
                baselinePages, [], fontWarnings, StringValues(request.Values), request.Mappings,
                "RENDER_VALIDATION_UNAVAILABLE"));
        }
    }

    private string OutputDirectory(string relativeDirectory)
    {
        var sentinel = paths.ResolveOutput($"{relativeDirectory}/page_0001.png");
        return Path.GetDirectoryName(sentinel)!;
    }

    private IReadOnlyList<string> RelativePages(IReadOnlyList<string> pagePaths) => pagePaths
        .Select(path => Path.GetRelativePath(options.StorageRoot, path).Replace('\\', '/'))
        .ToArray();

    private static IReadOnlyDictionary<string, string> StringValues(IReadOnlyDictionary<string, object?> values) =>
        values.ToDictionary(
            item => item.Key,
            item => Convert.ToString(item.Value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty,
            StringComparer.Ordinal);

    private static void ApplyCandidateLabels(string path, IReadOnlyList<StructuralCandidate> candidates)
    {
        using var package = WordprocessingDocument.Open(path, true);
        var locations = StructuralAnalyzer.LocateEditableElements(package);
        for (var index = 0; index < candidates.Count; index++)
        {
            if (!locations.TryGetValue(candidates[index].Locator, out var target) || target is not Paragraph paragraph) continue;
            var label = $"[C{index + 1:000}] ";
            var first = paragraph.Descendants<Text>().FirstOrDefault();
            if (first is null) paragraph.PrependChild(new Run(new Text(label) { Space = SpaceProcessingModeValues.Preserve }));
            else
            {
                first.Text = label + first.Text;
                first.Space = SpaceProcessingModeValues.Preserve;
            }
        }
        var main = package.MainDocumentPart;
        main?.Document?.Save();
        if (main is null) return;
        foreach (var header in main.HeaderParts) header.Header?.Save();
        foreach (var footer in main.FooterParts) footer.Footer?.Save();
        main.FootnotesPart?.Footnotes?.Save();
        main.EndnotesPart?.Endnotes?.Save();
    }

    private static void ValidateId(string value, string field)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 100 ||
            value.Any(character => !char.IsAsciiLetterOrDigit(character) && character != '-'))
            throw new InvalidOperationException($"{field} is invalid");
    }
}

public sealed class PackageRejectedException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
