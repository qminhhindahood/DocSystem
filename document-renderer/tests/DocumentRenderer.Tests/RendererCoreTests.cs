using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Editing;
using DocumentRenderer.Core.Rendering;
using DocumentRenderer.Core.Security;
using DocumentRenderer.Core.Processes;
using DocumentRenderer.Core.Verification;
using Vml = DocumentFormat.OpenXml.Vml;
using Xunit;
using System.Security.Cryptography;

namespace DocumentRenderer.Tests;

public sealed class RendererCoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"renderer-tests-{Guid.NewGuid():N}");

    public RendererCoreTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void OptionsExposeLibreOfficeProcessConfiguration()
    {
        var properties = typeof(RendererOptions).GetProperties().Select(property => property.Name).ToArray();

        Assert.Contains("LibreOfficeExecutable", properties);
        Assert.Contains("PdfToPngExecutable", properties);
        Assert.Contains("TempRoot", properties);
    }

    [Fact]
    public async Task ReadinessReturnsOnlyStableCodesForFailedDependencies()
    {
        var blockedPath = Path.Combine(_root, "not-a-directory");
        await File.WriteAllTextAsync(blockedPath, "document content must not leak");
        var options = Options(serviceToken: "") with
        {
            StorageRoot = blockedPath,
            TempRoot = blockedPath,
            ReadinessDocumentPath = Path.Combine(_root, "missing-smoke.docx"),
            RequiredFonts = ["Liberation Serif"],
        };
        var runner = new ReadinessProcessRunner(_ =>
            Task.FromResult(new ProcessResult(1, "sensitive command output", "sensitive error", false)));
        var readiness = new RendererReadiness(options, runner, new FailingReadinessPageRenderer());

        var result = await readiness.CheckAsync(default);

        Assert.False(result.Ready);
        Assert.Contains("TOKEN_UNSAFE", result.Errors);
        Assert.Contains("LIBREOFFICE_UNAVAILABLE", result.Errors);
        Assert.Contains("POPPLER_UNAVAILABLE", result.Errors);
        Assert.Contains("FONT_UNAVAILABLE", result.Errors);
        Assert.Contains("STORAGE_UNWRITABLE", result.Errors);
        Assert.Contains("TEMP_UNWRITABLE", result.Errors);
        Assert.Contains("SMOKE_RENDER_FAILED", result.Errors);
        Assert.All(result.Errors, error =>
        {
            Assert.DoesNotContain(_root, error, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("sensitive", error, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("document content", error, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public async Task SuccessfulReadinessIsCachedForSixtySeconds()
    {
        var smoke = Path.Combine(_root, "readiness.docx");
        await File.WriteAllBytesAsync(smoke, [1, 2, 3]);
        var options = Options() with
        {
            ReadinessDocumentPath = smoke,
            RequiredFonts = ["Liberation Serif"],
        };
        var runner = new ReadinessProcessRunner(request => Task.FromResult(
            request.FileName == "fc-match"
                ? new ProcessResult(0, "Liberation Serif\n", "", false)
                : new ProcessResult(0, "version", "", false)));
        var pages = new SuccessfulReadinessPageRenderer();
        var readiness = new RendererReadiness(options, runner, pages);

        Assert.True((await readiness.CheckAsync(default)).Ready);
        Assert.True((await readiness.CheckAsync(default)).Ready);
        Assert.Equal(3, runner.Requests.Count);
        Assert.Contains(runner.Requests, request => request.FileName == "soffice" && request.Arguments.SequenceEqual(["--version"]));
        Assert.Contains(runner.Requests, request => request.FileName == "pdftoppm" && request.Arguments.SequenceEqual(["-v"]));
        Assert.Contains(runner.Requests, request => request.FileName == "fc-match" &&
            request.Arguments.SequenceEqual(["--format=%{family}\\n", "Liberation Serif"]));
        Assert.Equal(1, pages.CallCount);
    }

    [Fact]
    public void StorageResolverRejectsTraversalAndAbsolutePaths()
    {
        var resolver = new StoragePathResolver(Options());
        Assert.Throws<InvalidOperationException>(() => resolver.ResolveOutput("../outside.docx"));
        Assert.Throws<InvalidOperationException>(() => resolver.ResolveOutput(Path.GetFullPath("outside.docx")));
    }

    [Fact]
    public async Task PackageValidatorRejectsNonDocxData()
    {
        var path = Path.Combine(_root, "bad.docx");
        await File.WriteAllTextAsync(path, "not a package");
        var report = await new DocxPackageValidator().ValidateAsync(path);
        Assert.False(report.Valid);
        Assert.Equal("NOT_DOCX", report.Code);
    }

    [Fact]
    public void SemanticInsertionPreservesFloatingVmlShapeFingerprint()
    {
        var path = Path.Combine(_root, "floating.docx");
        using (var package = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document))
        {
            var main = package.AddMainDocumentPart();
            var floatingText = new Paragraph(new Run(new RunProperties(new Bold()), new Text("ORIGINAL")));
            var shape = new Vml.Shape(new Vml.TextBox(new TextBoxContent(floatingText))) { Id = "shape1" };
            main.Document = new Document(new Body(new Paragraph(new Run(new Picture(shape)))));
            main.Document.Save();
        }

        var analyzer = new StructuralAnalyzer();
        var before = analyzer.Analyze(path);
        var candidate = Assert.Single(before.Candidates, item => item.Kind == "FLOATING_TEXT_BOX");
        Assert.NotNull(candidate.Fingerprint);

        var violations = new SemanticInserter().Insert(
            path,
            new Dictionary<string, object?> { ["subject"] = "REPLACED" },
            [new FieldLocator("subject", candidate.Locator)]);
        Assert.Empty(violations);

        var after = analyzer.Analyze(path);
        var output = Assert.Single(after.Candidates, item => item.Locator == candidate.Locator);
        Assert.NotNull(output.Fingerprint);
        Assert.Equal(candidate.Fingerprint!["sha256"], output.Fingerprint["sha256"]);
        Assert.Equal("REPLACED", output.TextSnippet);
        using var updated = WordprocessingDocument.Open(path, false);
        Assert.NotNull(updated.MainDocumentPart!.Document!.Descendants<Bold>().FirstOrDefault());
    }

    [Fact]
    public async Task RepresentativeAdministrativeDocxRendersLabeledPagesWithoutMutatingOriginal()
    {
        var fixture = FindRepositoryFile("docs", "12-2017-tt-bgddt-19-05-2017.docx");
        var templateId = "representative-template";
        var relative = $"originals/test-user/{templateId}.docx";
        var destination = Path.Combine(_root, relative.Replace('/', Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.Copy(fixture, destination);
        var originalHash = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(destination))).ToLowerInvariant();
        var options = Options();
        var resolver = new StoragePathResolver(options);
        var analyzer = new StructuralAnalyzer();
        var engine = new DocumentRenderEngine(
            options,
            resolver,
            new DocxPackageValidator(),
            analyzer,
            new SemanticInserter(),
            new DocumentIntegrityVerifier(),
            new DeterministicPageRenderer(),
            new FontInspector(options, new NoopProcessRunner()),
            new FidelityAssessor());

        var result = await engine.AnalyzeAsync(new AnalyzeDocumentRequest(templateId, relative, originalHash), CancellationToken.None);

        Assert.True(result.Success);
        Assert.NotEmpty(result.Candidates);
        Assert.NotEmpty(result.BaselinePages);
        Assert.NotEmpty(result.LabeledPages);
        Assert.Equal(originalHash, Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(destination))).ToLowerInvariant());
        Assert.NotEqual(
            await File.ReadAllBytesAsync(resolver.ResolveExisting(result.BaselinePages[0])),
            await File.ReadAllBytesAsync(resolver.ResolveExisting(result.LabeledPages[0])));
    }

    private static string FindRepositoryFile(params string[] segments)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine([directory.FullName, .. segments]);
            if (File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("Repository DOCX fixture was not found");
    }

    private RendererOptions Options(string serviceToken = "a-secure-renderer-token-that-is-long-enough") => new()
    {
        StorageRoot = _root,
        TempRoot = _root,
        LibreOfficeExecutable = "soffice",
        PdfToPngExecutable = "pdftoppm",
        FontMatchExecutable = "fc-match",
        RequiredFonts = ["Times New Roman"],
        ServiceToken = serviceToken,
    };

    private sealed class DeterministicPageRenderer : IPageRenderer
    {
        public Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken)
        {
            Directory.CreateDirectory(request.OutputDirectory);
            var path = Path.Combine(request.OutputDirectory, "page_0001.png");
            var sourceHash = SHA256.HashData(File.ReadAllBytes(request.SourceDocx));
            File.WriteAllBytes(path, [137, 80, 78, 71, 13, 10, 26, 10, .. sourceHash]);
            return Task.FromResult<PageRenderResult>(new([path]));
        }
    }

    private sealed class NoopProcessRunner : IExternalProcessRunner
    {
        public Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken) =>
            Task.FromResult(new ProcessResult(0, request.Arguments[^1] + "\n", "", false));
    }

    private sealed class ReadinessProcessRunner(Func<ProcessRequest, Task<ProcessResult>> execute) : IExternalProcessRunner
    {
        public List<ProcessRequest> Requests { get; } = [];
        public Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return execute(request);
        }
    }

    private sealed class FailingReadinessPageRenderer : IPageRenderer
    {
        public Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken) =>
            throw new PageRenderException("FAILED", "document content");
    }

    private sealed class SuccessfulReadinessPageRenderer : IPageRenderer
    {
        public int CallCount { get; private set; }
        public Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken)
        {
            CallCount++;
            Directory.CreateDirectory(request.OutputDirectory);
            var page = Path.Combine(request.OutputDirectory, "page_0001.png");
            File.WriteAllBytes(page, [137, 80, 78, 71, 13, 10, 26, 10]);
            return Task.FromResult<PageRenderResult>(new([page]));
        }
    }
}
