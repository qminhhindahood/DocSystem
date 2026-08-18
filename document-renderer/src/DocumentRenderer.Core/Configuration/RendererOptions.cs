namespace DocumentRenderer.Core.Configuration;

public sealed record RendererOptions
{
    public required string StorageRoot { get; init; }
    public required string TempRoot { get; init; }
    public required string LibreOfficeExecutable { get; init; }
    public required string PdfToPngExecutable { get; init; }
    public required string FontMatchExecutable { get; init; }
    public required string[] RequiredFonts { get; init; }
    public required string ServiceToken { get; init; }
    public string ReadinessDocumentPath { get; init; } = Path.Combine(AppContext.BaseDirectory, "fixtures", "readiness.docx");
    public TimeSpan RenderTimeout { get; init; } = TimeSpan.FromSeconds(120);
    public int MaxConcurrentRenders { get; init; } = 2;
    public int PngDpi { get; init; } = 144;
    public int MaxRenderedPages { get; init; } = 100;
    public long MaxRenderedBytes { get; init; } = 256L * 1024 * 1024;
}

public sealed record ReadinessResult(bool Ready, IReadOnlyList<string> Errors);
