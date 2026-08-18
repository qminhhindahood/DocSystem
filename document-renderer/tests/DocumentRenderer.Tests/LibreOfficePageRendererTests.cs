using System.Security.Cryptography;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Processes;
using DocumentRenderer.Core.Rendering;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class LibreOfficePageRendererTests : IDisposable
{
    private static readonly byte[] Png = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"page-renderer-tests-{Guid.NewGuid():N}");
    private readonly string _sourceDocx;
    private readonly string _output;

    public LibreOfficePageRendererTests()
    {
        Directory.CreateDirectory(_root);
        _sourceDocx = Path.Combine(_root, "source document.docx");
        _output = Path.Combine(_root, "output pages");
        File.WriteAllBytes(_sourceDocx, [1, 2, 3, 4]);
    }

    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public async Task UsesDisposableCopyAndUniqueLibreOfficeProfile()
    {
        var originalHash = Sha256(_sourceDocx);
        var fake = SuccessfulRunner(pageCount: 2);
        var renderer = CreateRenderer(Options(), fake);

        var result = await renderer.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-1"), default);

        var soffice = Assert.Single(fake.Requests, request => request.FileName == "soffice");
        Assert.Contains(soffice.Arguments, value => value.StartsWith("-env:UserInstallation=file://", StringComparison.Ordinal));
        Assert.DoesNotContain(_sourceDocx, soffice.Arguments);
        Assert.Equal(["page_0001.png", "page_0002.png"], result.PagePaths.Select(Path.GetFileName));
        Assert.Equal(originalHash, Sha256(_sourceDocx));
        Assert.Empty(Directory.EnumerateFileSystemEntries(Options().TempRoot));
    }

    [Fact]
    public async Task ReplacesStalePagesOnlyAfterSuccessfulRasterization()
    {
        Directory.CreateDirectory(_output);
        File.WriteAllText(Path.Combine(_output, "page_0003.png"), "stale");
        var renderer = CreateRenderer(Options(), SuccessfulRunner(pageCount: 1));

        var result = await renderer.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-2"), default);

        Assert.Single(result.PagePaths);
        Assert.False(File.Exists(Path.Combine(_output, "page_0003.png")));
        Assert.Equal(Png, File.ReadAllBytes(Path.Combine(_output, "page_0001.png")));
    }

    [Fact]
    public async Task ConversionFailureRemovesTheDisposableProfileAndJobDirectory()
    {
        var fake = new RecordingProcessRunner(request => Task.FromResult(
            request.FileName == "soffice"
                ? new ProcessResult(1, "", "conversion failed", false)
                : new ProcessResult(0, "", "", false)));
        var renderer = CreateRenderer(Options(), fake);

        var error = await Assert.ThrowsAsync<PageRenderException>(() =>
            renderer.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-3"), default));

        Assert.Equal("LIBREOFFICE_FAILED", error.Code);
        Assert.Empty(Directory.EnumerateFileSystemEntries(Options().TempRoot));
    }

    [Fact]
    public async Task RejectsPageAndByteLimitsBeforePublishingPreviews()
    {
        var pageLimited = CreateRenderer(Options() with { MaxRenderedPages = 1 }, SuccessfulRunner(pageCount: 2));
        var pageError = await Assert.ThrowsAsync<PageRenderException>(() =>
            pageLimited.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-pages"), default));
        Assert.Equal("PAGE_LIMIT_EXCEEDED", pageError.Code);

        var byteLimited = CreateRenderer(Options() with { MaxRenderedBytes = 4 }, SuccessfulRunner(pageCount: 1));
        var byteError = await Assert.ThrowsAsync<PageRenderException>(() =>
            byteLimited.RenderAsync(new PageRenderRequest(_sourceDocx, _output, "job-bytes"), default));
        Assert.Equal("RENDER_SIZE_EXCEEDED", byteError.Code);
        Assert.False(Directory.Exists(_output));
    }

    [Fact]
    public async Task LimitsConcurrentRenderJobs()
    {
        var active = 0;
        var maximum = 0;
        var firstEntered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var fake = new RecordingProcessRunner(async request =>
        {
            if (request.FileName == "soffice")
            {
                var current = Interlocked.Increment(ref active);
                maximum = Math.Max(maximum, current);
                firstEntered.TrySetResult();
                await release.Task;
                File.WriteAllBytes(Path.Combine(request.WorkingDirectory, "input.pdf"), [1, 2, 3]);
                Interlocked.Decrement(ref active);
            }
            else
            {
                File.WriteAllBytes(request.Arguments[^1] + "-1.png", Png);
            }
            return new ProcessResult(0, "", "", false);
        });
        var renderer = CreateRenderer(Options() with { MaxConcurrentRenders = 1 }, fake);

        var first = renderer.RenderAsync(new PageRenderRequest(_sourceDocx, Path.Combine(_root, "one"), "one"), default);
        await firstEntered.Task;
        var second = renderer.RenderAsync(new PageRenderRequest(_sourceDocx, Path.Combine(_root, "two"), "two"), default);
        await Task.Delay(100);
        Assert.Equal(1, active);
        release.TrySetResult();

        await Task.WhenAll(first, second);
        Assert.Equal(1, maximum);
    }

    private RecordingProcessRunner SuccessfulRunner(int pageCount)
    {
        return new RecordingProcessRunner(request =>
        {
            if (request.FileName == "soffice")
            {
                Assert.True(File.Exists(Path.Combine(request.WorkingDirectory, "input.docx")));
                File.WriteAllBytes(Path.Combine(request.WorkingDirectory, "input.pdf"), [1, 2, 3]);
            }
            else if (request.FileName == "pdftoppm")
            {
                for (var page = 1; page <= pageCount; page++)
                    File.WriteAllBytes(request.Arguments[^1] + $"-{page}.png", Png);
            }
            return Task.FromResult(new ProcessResult(0, "", "", false));
        });
    }

    private static LibreOfficePageRenderer CreateRenderer(RendererOptions options, IExternalProcessRunner runner) =>
        new(options, runner, new PopplerPageRasterizer(options, runner));

    private RendererOptions Options() => new()
    {
        StorageRoot = _root,
        TempRoot = Path.Combine(_root, "temp"),
        LibreOfficeExecutable = "soffice",
        PdfToPngExecutable = "pdftoppm",
        FontMatchExecutable = "fc-match",
        RequiredFonts = ["Liberation Serif"],
        ServiceToken = "a-secure-renderer-token-that-is-long-enough",
    };

    private static string Sha256(string path) =>
        Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();

    private sealed class RecordingProcessRunner(
        Func<ProcessRequest, Task<ProcessResult>> execute) : IExternalProcessRunner
    {
        public List<ProcessRequest> Requests { get; } = [];

        public Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            lock (Requests) Requests.Add(request);
            return execute(request);
        }
    }
}
