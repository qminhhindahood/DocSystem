using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Processes;

namespace DocumentRenderer.Core.Rendering;

public sealed class LibreOfficePageRenderer : IPageRenderer, IDisposable
{
    private readonly RendererOptions _options;
    private readonly IExternalProcessRunner _processRunner;
    private readonly PopplerPageRasterizer _rasterizer;
    private readonly SemaphoreSlim _renderSlots;

    public LibreOfficePageRenderer(
        RendererOptions options,
        IExternalProcessRunner processRunner,
        PopplerPageRasterizer rasterizer)
    {
        if (options.MaxConcurrentRenders < 1) throw new ArgumentOutOfRangeException(nameof(options.MaxConcurrentRenders));
        _options = options;
        _processRunner = processRunner;
        _rasterizer = rasterizer;
        _renderSlots = new SemaphoreSlim(options.MaxConcurrentRenders, options.MaxConcurrentRenders);
    }

    public async Task<PageRenderResult> RenderAsync(PageRenderRequest request, CancellationToken cancellationToken)
    {
        if (!File.Exists(request.SourceDocx)) throw new FileNotFoundException("DOCX source is unavailable");
        cancellationToken.ThrowIfCancellationRequested();
        await _renderSlots.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_options.TempRoot);
            var jobDirectory = Path.Combine(_options.TempRoot, $"job-{Guid.NewGuid():N}");
            Directory.CreateDirectory(jobDirectory);
            try
            {
                var disposableDocx = Path.Combine(jobDirectory, "input.docx");
                var profileDirectory = Path.Combine(jobDirectory, "profile");
                Directory.CreateDirectory(profileDirectory);
                File.Copy(request.SourceDocx, disposableDocx, overwrite: false);

                var profileUri = new Uri(profileDirectory + Path.DirectorySeparatorChar).AbsoluteUri.TrimEnd('/');
                var conversion = await _processRunner.RunAsync(new ProcessRequest(
                    _options.LibreOfficeExecutable,
                    [
                        "--headless",
                        "--nologo",
                        "--nodefault",
                        "--nolockcheck",
                        "--norestore",
                        $"-env:UserInstallation={profileUri}",
                        "--convert-to",
                        "pdf:writer_pdf_Export",
                        "--outdir",
                        jobDirectory,
                        disposableDocx,
                    ],
                    jobDirectory,
                    _options.RenderTimeout), cancellationToken);
                if (conversion.TimedOut) throw new PageRenderException("LIBREOFFICE_TIMEOUT", "Document rendering timed out");
                if (conversion.ExitCode != 0) throw new PageRenderException("LIBREOFFICE_FAILED", "Document rendering failed");

                var pdfPath = Path.Combine(jobDirectory, "input.pdf");
                if (!File.Exists(pdfPath) || new FileInfo(pdfPath).Length == 0)
                    throw new PageRenderException("LIBREOFFICE_NO_PDF", "Document renderer produced no PDF");

                var pages = await _rasterizer.RasterizeAsync(pdfPath, jobDirectory, cancellationToken);
                var renderedBytes = new FileInfo(pdfPath).Length + pages.Sum(path => new FileInfo(path).Length);
                if (renderedBytes > _options.MaxRenderedBytes)
                    throw new PageRenderException("RENDER_SIZE_EXCEEDED", "Rendered output exceeds the size limit");

                return new PageRenderResult(PublishPages(pages, request.OutputDirectory));
            }
            finally
            {
                if (Directory.Exists(jobDirectory)) Directory.Delete(jobDirectory, recursive: true);
            }
        }
        finally
        {
            _renderSlots.Release();
        }
    }

    private static IReadOnlyList<string> PublishPages(IReadOnlyList<string> sourcePages, string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);
        var published = new List<string>(sourcePages.Count);
        var temporaryFiles = new List<string>(sourcePages.Count);
        try
        {
            for (var index = 0; index < sourcePages.Count; index++)
            {
                var target = Path.Combine(outputDirectory, $"page_{index + 1:0000}.png");
                var temporary = target + $".{Guid.NewGuid():N}.tmp";
                File.Copy(sourcePages[index], temporary, overwrite: false);
                temporaryFiles.Add(temporary);
                published.Add(target);
            }
            for (var index = 0; index < published.Count; index++)
            {
                File.Move(temporaryFiles[index], published[index], overwrite: true);
                temporaryFiles[index] = string.Empty;
            }
            var expected = published.ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var stale in Directory.EnumerateFiles(outputDirectory, "page_*.png", SearchOption.TopDirectoryOnly))
                if (!expected.Contains(stale)) File.Delete(stale);
            return published;
        }
        finally
        {
            foreach (var temporary in temporaryFiles.Where(path => !string.IsNullOrEmpty(path) && File.Exists(path)))
                File.Delete(temporary);
        }
    }

    public void Dispose() => _renderSlots.Dispose();
}
