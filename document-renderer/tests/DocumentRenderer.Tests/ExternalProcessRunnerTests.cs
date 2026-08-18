using System.Diagnostics;
using DocumentRenderer.Core.Processes;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class ExternalProcessRunnerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"process-runner-tests-{Guid.NewGuid():N}");

    public ExternalProcessRunnerTests() => Directory.CreateDirectory(_root);

    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void ProcessRequestStoresArgumentsWithoutACommandShell()
    {
        var request = new ProcessRequest(
            "soffice",
            ["--headless", "file name.docx"],
            _root,
            TimeSpan.FromSeconds(5));

        Assert.Equal("file name.docx", request.Arguments[1]);
        Assert.DoesNotContain("sh", request.FileName, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CancelledRequestDoesNotStartAProcess()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new ExternalProcessRunner().RunAsync(
                new ProcessRequest("definitely-not-started", [], _root, TimeSpan.FromSeconds(1)),
                cancellation.Token));
    }

    [Fact]
    public async Task NonZeroExitIsReturnedWithBoundedCapturedOutput()
    {
        var result = await new ExternalProcessRunner().RunAsync(NonZeroRequest(), CancellationToken.None);

        Assert.NotEqual(0, result.ExitCode);
        Assert.False(result.TimedOut);
        Assert.True(result.StandardOutput.Length <= ExternalProcessRunner.MaxCapturedCharacters);
        Assert.True(result.StandardError.Length <= ExternalProcessRunner.MaxCapturedCharacters);
    }

    [Fact]
    public async Task TimeoutStopsTheProcessTreeAndReturnsPromptly()
    {
        var stopwatch = Stopwatch.StartNew();

        var result = await new ExternalProcessRunner().RunAsync(TimeoutRequest(), CancellationToken.None);

        Assert.True(result.TimedOut);
        Assert.True(stopwatch.Elapsed < TimeSpan.FromSeconds(5));
    }

    private ProcessRequest NonZeroRequest()
    {
        if (OperatingSystem.IsWindows())
        {
            return new ProcessRequest(
                Path.Combine(Environment.SystemDirectory, "where.exe"),
                [$"missing-command-{Guid.NewGuid():N}"],
                _root,
                TimeSpan.FromSeconds(5));
        }

        return new ProcessRequest("/usr/bin/false", [], _root, TimeSpan.FromSeconds(5));
    }

    private ProcessRequest TimeoutRequest()
    {
        if (OperatingSystem.IsWindows())
        {
            return new ProcessRequest(
                Path.Combine(Environment.SystemDirectory, "ping.exe"),
                ["127.0.0.1", "-n", "30"],
                _root,
                TimeSpan.FromMilliseconds(150));
        }

        return new ProcessRequest("/bin/sleep", ["30"], _root, TimeSpan.FromMilliseconds(150));
    }
}
