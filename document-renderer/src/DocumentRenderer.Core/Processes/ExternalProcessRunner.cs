using System.Diagnostics;
using System.Text;

namespace DocumentRenderer.Core.Processes;

public sealed class ExternalProcessRunner : IExternalProcessRunner
{
    public const int MaxCapturedCharacters = 16 * 1024;

    public async Task<ProcessResult> RunAsync(ProcessRequest request, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(request.FileName);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.WorkingDirectory);
        if (request.Timeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(request), "Timeout must be positive");
        if (!Directory.Exists(request.WorkingDirectory)) throw new DirectoryNotFoundException("Process working directory is unavailable");
        cancellationToken.ThrowIfCancellationRequested();

        var startInfo = new ProcessStartInfo
        {
            FileName = request.FileName,
            WorkingDirectory = request.WorkingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var argument in request.Arguments) startInfo.ArgumentList.Add(argument);
        if (request.Environment is not null)
        {
            foreach (var (key, value) in request.Environment)
            {
                ArgumentException.ThrowIfNullOrWhiteSpace(key);
                startInfo.Environment[key] = value;
            }
        }

        using var process = new Process { StartInfo = startInfo };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("External process could not be started");
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            throw new InvalidOperationException("External process could not be started", error);
        }

        var standardOutput = ReadBoundedAsync(process.StandardOutput);
        var standardError = ReadBoundedAsync(process.StandardError);
        using var timeout = new CancellationTokenSource(request.Timeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        var timedOut = false;

        try
        {
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            KillProcessTree(process);
            await WaitForExitAfterKillAsync(process);
            await Task.WhenAll(standardOutput, standardError);
            throw;
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            timedOut = true;
            KillProcessTree(process);
            await WaitForExitAfterKillAsync(process);
        }

        await Task.WhenAll(standardOutput, standardError);
        return new ProcessResult(
            process.ExitCode,
            await standardOutput,
            await standardError,
            timedOut);
    }

    private static async Task<string> ReadBoundedAsync(StreamReader reader)
    {
        var captured = new StringBuilder(MaxCapturedCharacters);
        var buffer = new char[4096];
        while (true)
        {
            var read = await reader.ReadAsync(buffer.AsMemory());
            if (read == 0) break;
            var remaining = MaxCapturedCharacters - captured.Length;
            if (remaining > 0) captured.Append(buffer, 0, Math.Min(read, remaining));
        }
        return captured.ToString();
    }

    private static void KillProcessTree(Process process)
    {
        try
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException)
        {
            // The process exited between the state check and termination request.
        }
    }

    private static async Task WaitForExitAfterKillAsync(Process process)
    {
        try
        {
            await process.WaitForExitAsync(CancellationToken.None);
        }
        catch (InvalidOperationException)
        {
            // No further action is required when the process already exited.
        }
    }
}
