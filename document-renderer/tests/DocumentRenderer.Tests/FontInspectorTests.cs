using System.IO.Compression;
using System.Text;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Processes;
using DocumentRenderer.Core.Rendering;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class FontInspectorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"font-inspector-{Guid.NewGuid():N}");

    public FontInspectorTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void ExtractsNormalizedDistinctFontsFromDocumentParts()
    {
        var path = CreatePackage();
        var inspector = new FontInspector(Options(), new FakeRunner(_ => throw new InvalidOperationException()));

        Assert.Equal(["Arial", "Calibri", "Times New Roman"], inspector.ExtractDeclaredFonts(path));
    }

    [Fact]
    public async Task ReportsFontSubstitutionWithRequestedAndResolvedFamilies()
    {
        var path = CreatePackage();
        var runner = new FakeRunner(request => Task.FromResult(new ProcessResult(
            0,
            request.Arguments[^1] == "Times New Roman" ? "Liberation Serif\n" : request.Arguments[^1] + "\n",
            "",
            false)));

        var result = await new FontInspector(Options(), runner).InspectAsync(path, default);

        var warning = Assert.Single(result.Warnings, item => item.Code == "FONT_SUBSTITUTED");
        Assert.Equal("warning", warning.Severity);
        Assert.Equal("Times New Roman", warning.Details!["requested"]);
        Assert.Equal("Liberation Serif", warning.Details["resolved"]);
        Assert.All(runner.Requests, request => Assert.Equal(["--format=%{family}\\n", request.Arguments[^1]], request.Arguments));
    }

    [Fact]
    public async Task ReportsUnavailableWhenFontconfigFails()
    {
        var result = await new FontInspector(Options(), new FakeRunner(_ =>
            Task.FromResult(new ProcessResult(1, "", "failure", false)))).InspectAsync(CreatePackage(), default);

        Assert.Contains(result.Warnings, warning => warning.Code == "FONT_VALIDATION_UNAVAILABLE");
    }

    private string CreatePackage()
    {
        var path = Path.Combine(_root, $"{Guid.NewGuid():N}.docx");
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        Add(archive, "word/document.xml", "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii='Calibri'/></w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>");
        Add(archive, "word/styles.xml", "<w:styles xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:style><w:rPr><w:rFonts w:hAnsi=' Arial '/></w:rPr></w:style></w:styles>");
        Add(archive, "word/theme/theme1.xml", "<a:theme xmlns:a='http://schemas.openxmlformats.org/drawingml/2006/main'><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface='Times New Roman'/></a:majorFont></a:fontScheme></a:themeElements></a:theme>");
        return path;
    }

    private static void Add(ZipArchive archive, string name, string xml)
    {
        var entry = archive.CreateEntry(name);
        using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
        writer.Write(xml);
    }

    private RendererOptions Options() => new()
    {
        StorageRoot = _root,
        TempRoot = _root,
        LibreOfficeExecutable = "soffice",
        PdfToPngExecutable = "pdftoppm",
        FontMatchExecutable = "fc-match",
        RequiredFonts = [],
        ServiceToken = "test-renderer-service-token-long-enough",
    };

    private sealed class FakeRunner(Func<ProcessRequest, Task<ProcessResult>> action) : IExternalProcessRunner
    {
        public List<ProcessRequest> Requests { get; } = [];
        public Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken)
        {
            Requests.Add(request);
            return action(request);
        }
    }
}
