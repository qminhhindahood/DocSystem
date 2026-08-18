using System.IO.Compression;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Editing;
using DocumentRenderer.Core.Processes;
using DocumentRenderer.Core.Rendering;
using DocumentRenderer.Core.Security;
using DocumentRenderer.Core.Verification;
using Vml = DocumentFormat.OpenXml.Vml;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class BestEffortRenderTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"best-effort-render-{Guid.NewGuid():N}");

    public BestEffortRenderTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public async Task VisualFailureReturnsPublishedStructurallyValidDocumentWithWarning()
    {
        var (relative, candidate) = CreateTemplate("template-one");
        var engine = CreateEngine(new ThrowingPageRenderer("RENDER_TIMEOUT"));

        var response = await engine.RenderAsync(new RenderDocumentRequest(
            "template-one", "user-one", "document-one", relative,
            new Dictionary<string, object?> { ["subject"] = "Replacement" },
            [new FieldLocator("subject", candidate.Locator)]), default);

        Assert.True(response.Success);
        Assert.NotNull(response.OutputRelativePath);
        Assert.Matches("^[a-f0-9]{64}$", response.OutputSha256!);
        Assert.Equal(FidelityValidationStatus.Unavailable, response.FidelityReport.ValidationStatus);
        Assert.Contains(response.FidelityReport.Warnings, warning => warning.Code == "RENDER_TIMEOUT");
        Assert.True(File.Exists(Path.Combine(_root, response.OutputRelativePath!.Replace('/', Path.DirectorySeparatorChar))));
    }

    [Fact]
    public void ShapeGeometryChangesAreFatal()
    {
        var path = CreateTemplate("shape-check").Relative;
        var absolute = Path.Combine(_root, path.Replace('/', Path.DirectorySeparatorChar));
        var before = Analysis(new StructuralCandidate("main/p[1]", "FLOATING_TEXT_BOX", Fingerprint("before"), ""));
        var after = Analysis(new StructuralCandidate("main/p[1]", "FLOATING_TEXT_BOX", Fingerprint("after"), ""));

        var error = Assert.Throws<DocumentIntegrityException>(() =>
            new DocumentIntegrityVerifier().VerifyOrThrow(absolute, absolute, before, after, []));

        Assert.Equal("SHAPE_GEOMETRY_CHANGED", error.Code);
    }

    [Fact]
    public void MissingStructuralLocatorIsFatal()
    {
        var path = CreateTemplate("locator-check").Relative;
        var absolute = Path.Combine(_root, path.Replace('/', Path.DirectorySeparatorChar));
        var error = Assert.Throws<DocumentIntegrityException>(() =>
            new DocumentIntegrityVerifier().VerifyOrThrow(
                absolute, absolute,
                Analysis(new StructuralCandidate("main/p[1]", "BODY_PARAGRAPH", null, "")),
                Analysis(), []));

        Assert.Equal("STRUCTURE_CHANGED", error.Code);
    }

    [Fact]
    public void ChangedStaticPackagePartIsFatal()
    {
        var relative = CreateTemplate("static-check").Relative;
        var original = Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar));
        var output = Path.Combine(_root, "changed.docx");
        File.Copy(original, output);
        using (var archive = ZipFile.Open(output, ZipArchiveMode.Update))
        {
            var entry = archive.CreateEntry("custom/static.bin");
            using var writer = new StreamWriter(entry.Open());
            writer.Write("changed");
        }

        var analysis = new StructuralAnalyzer().Analyze(original);
        var error = Assert.Throws<DocumentIntegrityException>(() =>
            new DocumentIntegrityVerifier().VerifyOrThrow(original, output, analysis, analysis, []));

        Assert.Equal("STATIC_PART_CHANGED", error.Code);
    }

    [Fact]
    public async Task InvalidLocatorDoesNotOverwritePreviousValidOutput()
    {
        var (relative, _) = CreateTemplate("template-two");
        var final = Path.Combine(_root, "generated", "user-one", "document-two.docx");
        Directory.CreateDirectory(Path.GetDirectoryName(final)!);
        await File.WriteAllTextAsync(final, "previous-valid-output");

        var error = await Assert.ThrowsAsync<DocumentIntegrityException>(() => CreateEngine(new ThrowingPageRenderer("unused"))
            .RenderAsync(new RenderDocumentRequest(
                "template-two", "user-one", "document-two", relative,
                new Dictionary<string, object?> { ["subject"] = "Replacement" },
                [new FieldLocator("subject", "missing::locator")]), default));

        Assert.Equal("LOCATOR_NOT_FOUND", error.Code);
        Assert.Equal("previous-valid-output", await File.ReadAllTextAsync(final));
    }

    [Fact]
    public async Task PageGrowthIsAdvisoryAndReturnsBoundedShortening()
    {
        var (relative, candidate) = CreateTemplate("template-growth");
        var baseline = Path.Combine(_root, "previews", "template-growth", "baseline");
        Directory.CreateDirectory(baseline);
        File.WriteAllBytes(Path.Combine(baseline, "page_0001.png"), Png);

        var response = await CreateEngine(new FixedPageRenderer(2)).RenderAsync(new RenderDocumentRequest(
            "template-growth", "user-one", "document-growth", relative,
            new Dictionary<string, object?> { ["subject"] = new string('x', 100) },
            [new FieldLocator("subject", candidate.Locator)]), default);

        Assert.True(response.Success);
        Assert.Contains(response.FidelityReport.Warnings, warning => warning.Code == "POSSIBLE_OVERFLOW");
        Assert.Equal(new ShortenRequest("subject", 80), response.ShortenRequired);
        Assert.True(File.Exists(Path.Combine(_root, "generated", "user-one", "document-growth.docx")));
    }

    private DocumentRenderEngine CreateEngine(IPageRenderer pageRenderer)
    {
        var options = Options();
        return new DocumentRenderEngine(
            options,
            new StoragePathResolver(options),
            new DocxPackageValidator(),
            new StructuralAnalyzer(),
            new SemanticInserter(),
            new DocumentIntegrityVerifier(),
            pageRenderer,
            new FontInspector(options, new NoopProcessRunner()),
            new FidelityAssessor());
    }

    private (string Relative, StructuralCandidate Candidate) CreateTemplate(string templateId)
    {
        var relative = $"originals/user-one/{templateId}.docx";
        var path = Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        using (var package = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document))
        {
            var main = package.AddMainDocumentPart();
            var floatingText = new Paragraph(new Run(new Text("Original")));
            var shape = new Vml.Shape(new Vml.TextBox(new TextBoxContent(floatingText)))
            {
                Id = "shape1",
                Style = "position:absolute;margin-left:10pt;margin-top:20pt;width:100pt;height:40pt",
            };
            main.Document = new Document(new Body(new Paragraph(new Run(new Picture(shape)))));
            main.Document.Save();
        }
        var candidate = Assert.Single(new StructuralAnalyzer().Analyze(path).Candidates, item => item.Kind == "FLOATING_TEXT_BOX");
        return (relative, candidate);
    }

    private RendererOptions Options() => new()
    {
        StorageRoot = _root,
        TempRoot = Path.Combine(_root, "temp"),
        LibreOfficeExecutable = "soffice",
        PdfToPngExecutable = "pdftoppm",
        FontMatchExecutable = "fc-match",
        RequiredFonts = [],
        ServiceToken = "test-renderer-service-token-long-enough",
    };

    private static StructuralAnalysis Analysis(params StructuralCandidate[] candidates) => new("fingerprint", candidates, []);
    private static IReadOnlyDictionary<string, string> Fingerprint(string hash) =>
        new Dictionary<string, string> { ["sha256"] = hash };

    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    private sealed class ThrowingPageRenderer(string code) : IPageRenderer
    {
        public Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken) =>
            throw new PageRenderException(code, "render failed");
    }

    private sealed class FixedPageRenderer(int pageCount) : IPageRenderer
    {
        public Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(request.OutputDirectory);
            var pages = Enumerable.Range(1, pageCount).Select(index =>
            {
                var path = Path.Combine(request.OutputDirectory, $"page_{index:0000}.png");
                File.WriteAllBytes(path, Png);
                return path;
            }).ToArray();
            return Task.FromResult<PageRenderResult>(new(pages));
        }
    }

    private sealed class NoopProcessRunner : IExternalProcessRunner
    {
        public Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new ProcessResult(0, request.Arguments[^1] + "\n", "", false));
    }
}
