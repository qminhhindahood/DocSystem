using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Processes;

namespace DocumentRenderer.Core.Rendering;

public sealed class RendererReadiness(
    RendererOptions options,
    IExternalProcessRunner processRunner,
    IPageRenderer pageRenderer)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(60);
    private readonly SemaphoreSlim _checkLock = new(1, 1);
    private ReadinessResult? _cached;
    private DateTimeOffset _cachedAt;

    public async Task<ReadinessResult> CheckAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (FreshCache() is { } cached) return cached;
        await _checkLock.WaitAsync(cancellationToken);
        try
        {
            if (FreshCache() is { } lockedCache) return lockedCache;
            var result = await CheckUncachedAsync(cancellationToken);
            _cached = result;
            _cachedAt = DateTimeOffset.UtcNow;
            return result;
        }
        finally
        {
            _checkLock.Release();
        }
    }

    private ReadinessResult? FreshCache() =>
        _cached is not null && DateTimeOffset.UtcNow - _cachedAt < CacheDuration ? _cached : null;

    private async Task<ReadinessResult> CheckUncachedAsync(CancellationToken cancellationToken)
    {
        var errors = new HashSet<string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(options.ServiceToken) ||
            options.ServiceToken.StartsWith("change-me", StringComparison.OrdinalIgnoreCase) ||
            options.ServiceToken.Length < 24)
            errors.Add("TOKEN_UNSAFE");

        ProbeWritableDirectory(options.StorageRoot, "STORAGE_UNWRITABLE", errors);
        ProbeWritableDirectory(options.TempRoot, "TEMP_UNWRITABLE", errors);

        if (!await ProcessSucceeds(options.LibreOfficeExecutable, ["--version"], cancellationToken))
            errors.Add("LIBREOFFICE_UNAVAILABLE");
        if (!await ProcessSucceeds(options.PdfToPngExecutable, ["-v"], cancellationToken))
            errors.Add("POPPLER_UNAVAILABLE");
        foreach (var requiredFont in options.RequiredFonts)
            if (!await FontResolves(requiredFont, cancellationToken))
                errors.Add("FONT_UNAVAILABLE");

        if (!await SmokeRenderSucceeds(cancellationToken)) errors.Add("SMOKE_RENDER_FAILED");
        var ordered = errors.OrderBy(code => code, StringComparer.Ordinal).ToArray();
        return new ReadinessResult(ordered.Length == 0, ordered);
    }

    private async Task<bool> ProcessSucceeds(
        string executable,
        IReadOnlyList<string> arguments,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await processRunner.RunAsync(new ProcessRequest(
                executable, arguments, options.TempRoot, options.RenderTimeout), cancellationToken);
            return !result.TimedOut && result.ExitCode == 0;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return false;
        }
    }

    private async Task<bool> FontResolves(string requiredFont, CancellationToken cancellationToken)
    {
        try
        {
            var result = await processRunner.RunAsync(new ProcessRequest(
                options.FontMatchExecutable,
                ["--format=%{family}\\n", requiredFont],
                options.TempRoot,
                options.RenderTimeout), cancellationToken);
            if (result.TimedOut || result.ExitCode != 0) return false;
            var resolved = result.StandardOutput
                .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(line => line.Split(',', 2, StringSplitOptions.TrimEntries)[0])
                .FirstOrDefault();
            return string.Equals(requiredFont.Trim(), resolved?.Trim(), StringComparison.OrdinalIgnoreCase);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return false;
        }
    }

    private async Task<bool> SmokeRenderSucceeds(CancellationToken cancellationToken)
    {
        if (!File.Exists(options.ReadinessDocumentPath)) return false;
        var output = Path.Combine(options.TempRoot, $"readiness-{Guid.NewGuid():N}");
        var succeeded = false;
        var cleanupSucceeded = true;
        try
        {
            var result = await pageRenderer.RenderAsync(new PageRenderRequest(
                options.ReadinessDocumentPath, output, "readiness"), cancellationToken);
            succeeded = result.PagePaths.Count > 0 && result.PagePaths.All(File.Exists);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            succeeded = false;
        }
        finally
        {
            try
            {
                if (Directory.Exists(output)) Directory.Delete(output, recursive: true);
            }
            catch
            {
                cleanupSucceeded = false;
            }
        }
        return succeeded && cleanupSucceeded;
    }

    private static void ProbeWritableDirectory(string path, string code, ICollection<string> errors)
    {
        string? probe = null;
        try
        {
            Directory.CreateDirectory(path);
            probe = Path.Combine(path, $".probe-{Guid.NewGuid():N}");
            File.WriteAllText(probe, "ok");
        }
        catch
        {
            errors.Add(code);
        }
        finally
        {
            try
            {
                if (probe is not null && File.Exists(probe)) File.Delete(probe);
            }
            catch
            {
                errors.Add(code);
            }
        }
    }
}
