namespace DocumentRenderer.Core.Rendering;

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
