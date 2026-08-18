using System.Buffers.Binary;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Rendering;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class FidelityAssessorTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"fidelity-assessor-{Guid.NewGuid():N}");

    public FidelityAssessorTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Fact]
    public void PageGrowthProducesHighWarningAndBoundedShortenRequest()
    {
        var result = new FidelityAssessor().Assess(new FidelityAssessmentInput(
            [Png(100, 100)],
            [Png(100, 100), Png(100, 100)],
            [],
            new Dictionary<string, string> { ["subject"] = new('x', 100) },
            [new FieldLocator("subject", "main/p[1]")]));

        Assert.Contains(result.Warnings, warning => warning.Code == "PAGE_COUNT_CHANGED" && warning.Severity == "high");
        Assert.Contains(result.Warnings, warning => warning.Code == "POSSIBLE_OVERFLOW");
        Assert.Equal(new ShortenRequest("subject", 80), result.ShortenRequired);
        Assert.Equal(FidelityValidationStatus.Warnings, result.Report.ValidationStatus);
        Assert.False(result.Report.Passed);
    }

    [Fact]
    public void ReportsChangedPageDimensions()
    {
        var result = new FidelityAssessor().Assess(new FidelityAssessmentInput(
            [Png(100, 100)], [Png(101, 100)], [], new Dictionary<string, string>(), []));

        Assert.Contains(result.Warnings, warning => warning.Code == "PAGE_DIMENSIONS_CHANGED");
        Assert.Equal(FidelityValidationStatus.Warnings, result.Report.ValidationStatus);
    }

    [Fact]
    public void MatchingPagesWithoutFontWarningsPass()
    {
        var result = new FidelityAssessor().Assess(new FidelityAssessmentInput(
            [Png(100, 100)], [Png(100, 100)], [], new Dictionary<string, string>(), []));

        Assert.Empty(result.Warnings);
        Assert.Equal(FidelityValidationStatus.Passed, result.Report.ValidationStatus);
        Assert.True(result.Report.Passed);
    }

    [Fact]
    public void RenderFailureMakesValidationUnavailable()
    {
        var result = new FidelityAssessor().Assess(new FidelityAssessmentInput(
            [Png(100, 100)], [], [], new Dictionary<string, string>(), [], "RENDER_TIMEOUT"));

        Assert.Contains(result.Warnings, warning => warning.Code == "RENDER_TIMEOUT");
        Assert.Equal(FidelityValidationStatus.Unavailable, result.Report.ValidationStatus);
        Assert.False(result.Report.Passed);
    }

    private string Png(int width, int height)
    {
        var path = Path.Combine(_root, $"{Guid.NewGuid():N}.png");
        var bytes = new byte[24];
        byte[] signature = [137, 80, 78, 71, 13, 10, 26, 10];
        signature.CopyTo(bytes, 0);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16, 4), width);
        BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20, 4), height);
        File.WriteAllBytes(path, bytes);
        return path;
    }
}
