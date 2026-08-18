using System.Globalization;
using System.Text.RegularExpressions;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Processes;

namespace DocumentRenderer.Core.Rendering;

public sealed partial class PopplerPageRasterizer(
    RendererOptions options,
    IExternalProcessRunner processRunner)
{
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    public async Task<IReadOnlyList<string>> RasterizeAsync(
        string pdfPath,
        string jobDirectory,
        CancellationToken cancellationToken)
    {
        var outputPrefix = Path.Combine(jobDirectory, "page");
        var result = await processRunner.RunAsync(new ProcessRequest(
            options.PdfToPngExecutable,
            ["-png", "-r", options.PngDpi.ToString(CultureInfo.InvariantCulture), pdfPath, outputPrefix],
            jobDirectory,
            options.RenderTimeout), cancellationToken);
        if (result.TimedOut) throw new PageRenderException("POPPLER_TIMEOUT", "PDF page rendering timed out");
        if (result.ExitCode != 0) throw new PageRenderException("POPPLER_FAILED", "PDF page rendering failed");

        var pages = Directory.EnumerateFiles(jobDirectory, "page-*.png", SearchOption.TopDirectoryOnly)
            .Select(path => (Path: path, Match: PageNamePattern().Match(Path.GetFileName(path))))
            .Where(item => item.Match.Success)
            .Select(item => (item.Path, Page: int.Parse(item.Match.Groups[1].Value, CultureInfo.InvariantCulture)))
            .OrderBy(item => item.Page)
            .ToArray();
        if (pages.Length == 0) throw new PageRenderException("NO_RENDERED_PAGES", "PDF renderer produced no pages");
        if (pages.Length > options.MaxRenderedPages)
            throw new PageRenderException("PAGE_LIMIT_EXCEEDED", "Rendered output exceeds the page limit");

        foreach (var (path, _) in pages)
        {
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0 || !HasPngSignature(path))
                throw new PageRenderException("INVALID_RENDERED_PAGE", "PDF renderer produced an invalid page image");
        }
        return pages.Select(item => item.Path).ToArray();
    }

    private static bool HasPngSignature(string path)
    {
        using var stream = File.OpenRead(path);
        Span<byte> signature = stackalloc byte[PngSignature.Length];
        return stream.Read(signature) == signature.Length && signature.SequenceEqual(PngSignature);
    }

    [GeneratedRegex("^page-([0-9]+)\\.png$", RegexOptions.CultureInvariant)]
    private static partial Regex PageNamePattern();
}
