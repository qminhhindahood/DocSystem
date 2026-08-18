using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Editing;
using DocumentRenderer.Core.Processes;
using DocumentRenderer.Core.Rendering;
using DocumentRenderer.Core.Security;
using DocumentRenderer.Core.Verification;

var builder = WebApplication.CreateBuilder(args);
var options = new RendererOptions
{
    StorageRoot = Environment.GetEnvironmentVariable("RENDERER_STORAGE_ROOT") ?? "/data/templates",
    TempRoot = Environment.GetEnvironmentVariable("RENDERER_TEMP_ROOT") ?? "/tmp/document-renderer",
    LibreOfficeExecutable = Environment.GetEnvironmentVariable("LIBREOFFICE_PATH") ?? "soffice",
    PdfToPngExecutable = Environment.GetEnvironmentVariable("PDFTOPPM_PATH") ?? "pdftoppm",
    FontMatchExecutable = Environment.GetEnvironmentVariable("FC_MATCH_PATH") ?? "fc-match",
    RequiredFonts = (Environment.GetEnvironmentVariable("RENDERER_REQUIRED_FONTS") ?? "Liberation Serif,Liberation Sans,Carlito")
        .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
    ServiceToken = Environment.GetEnvironmentVariable("RENDERER_SERVICE_TOKEN") ?? "",
    ReadinessDocumentPath = Environment.GetEnvironmentVariable("RENDERER_READINESS_DOCUMENT")
        ?? Path.Combine(AppContext.BaseDirectory, "fixtures", "readiness.docx"),
    RenderTimeout = TimeSpan.FromSeconds(ParseBoundedInt("RENDERER_RENDER_TIMEOUT_SECONDS", 120, 10, 300)),
    MaxConcurrentRenders = ParseBoundedInt("RENDERER_MAX_CONCURRENT_RENDERS", 2, 1, 8),
    PngDpi = ParseBoundedInt("RENDERER_PNG_DPI", 144, 72, 300),
    MaxRenderedPages = ParseBoundedInt("RENDERER_MAX_RENDERED_PAGES", 100, 1, 500),
    MaxRenderedBytes = ParseBoundedLong("RENDERER_MAX_RENDERED_BYTES", 268_435_456, 1_048_576, 536_870_912),
};
builder.Services.ConfigureHttpJsonOptions(json =>
{
    json.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    json.SerializerOptions.DictionaryKeyPolicy = null;
    json.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
});
builder.Services.AddSingleton(options);
builder.Services.AddSingleton<StoragePathResolver>();
builder.Services.AddSingleton<DocxPackageValidator>();
builder.Services.AddSingleton<StructuralAnalyzer>();
builder.Services.AddSingleton<SemanticInserter>();
builder.Services.AddSingleton<DocumentIntegrityVerifier>();
builder.Services.AddSingleton<IExternalProcessRunner, ExternalProcessRunner>();
builder.Services.AddSingleton<PopplerPageRasterizer>();
builder.Services.AddSingleton<IPageRenderer, LibreOfficePageRenderer>();
builder.Services.AddSingleton<FontInspector>();
builder.Services.AddSingleton<FidelityAssessor>();
builder.Services.AddSingleton<RendererReadiness>();
builder.Services.AddSingleton<DocumentRenderEngine>();

var app = builder.Build();
var readinessService = app.Services.GetRequiredService<RendererReadiness>();
await readinessService.CheckAsync(CancellationToken.None);
app.MapGet("/live", () => Results.Ok(new { status = "alive" }));
app.MapGet("/ready", async (RendererReadiness readiness, CancellationToken cancellationToken) =>
{
    var result = await readiness.CheckAsync(cancellationToken);
    return result.Ready ? Results.Ok(result) : Results.Json(result, statusCode: 503);
});

app.Use(async (context, next) =>
{
    if (!context.Request.Path.StartsWithSegments("/internal")) { await next(); return; }
    var supplied = context.Request.Headers["X-Renderer-Token"].ToString();
    var expected = options.ServiceToken;
    var valid = !string.IsNullOrEmpty(expected)
        && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(supplied), Encoding.UTF8.GetBytes(expected));
    if (!valid) { context.Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
    if (!(await readinessService.CheckAsync(context.RequestAborted)).Ready)
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        await context.Response.WriteAsJsonAsync(new { error = "Renderer is not ready" });
        return;
    }
    await next();
});

app.MapPost("/internal/templates/analyze", async (AnalyzeDocumentRequest request, DocumentRenderEngine engine, CancellationToken ct) =>
{
    try { return Results.Ok(await engine.AnalyzeAsync(request, ct)); }
    catch (PackageRejectedException error) { return Results.UnprocessableEntity(new { success = false, code = error.Code }); }
    catch (DocumentIntegrityException error) { return Results.UnprocessableEntity(new { success = false, code = error.Code }); }
    catch (FileNotFoundException) { return Results.NotFound(new { error = "Template file not found" }); }
    catch (InvalidOperationException error) { return Results.BadRequest(new { error = error.Message }); }
});
app.MapPost("/internal/templates/render", async (RenderDocumentRequest request, DocumentRenderEngine engine, CancellationToken ct) =>
{
    try { return Results.Ok(await engine.RenderAsync(request, ct)); }
    catch (PackageRejectedException error) { return Results.UnprocessableEntity(new { success = false, code = error.Code }); }
    catch (DocumentIntegrityException error) { return Results.UnprocessableEntity(new { success = false, code = error.Code }); }
    catch (FileNotFoundException) { return Results.NotFound(new { error = "Template file not found" }); }
    catch (InvalidOperationException error) { return Results.BadRequest(new { error = error.Message }); }
});

app.Run();

static int ParseBoundedInt(string name, int fallback, int minimum, int maximum)
{
    var raw = Environment.GetEnvironmentVariable(name);
    return int.TryParse(raw, out var value) && value >= minimum && value <= maximum ? value : fallback;
}

static long ParseBoundedLong(string name, long fallback, long minimum, long maximum)
{
    var raw = Environment.GetEnvironmentVariable(name);
    return long.TryParse(raw, out var value) && value >= minimum && value <= maximum ? value : fallback;
}

public partial class Program;
