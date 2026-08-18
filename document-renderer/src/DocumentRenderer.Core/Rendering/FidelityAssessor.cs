using System.Buffers.Binary;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Rendering;

public sealed record FidelityAssessmentInput(
    IReadOnlyList<string> BaselinePages,
    IReadOnlyList<string> GeneratedPages,
    IReadOnlyList<FidelityWarning> FontWarnings,
    IReadOnlyDictionary<string, string> Values,
    IReadOnlyList<FieldLocator> Mappings,
    string? RenderFailureCode = null);

public sealed record FidelityAssessment(FidelityReport Report, ShortenRequest? ShortenRequired)
{
    public IReadOnlyList<FidelityWarning> Warnings => Report.Warnings;
}

public sealed class FidelityAssessor
{
    public FidelityAssessment Assess(FidelityAssessmentInput input)
    {
        var warnings = new List<FidelityWarning>(input.FontWarnings);
        if (input.RenderFailureCode is not null)
        {
            warnings.Add(new FidelityWarning(
                input.RenderFailureCode,
                "warning",
                "Visual fidelity validation was unavailable; the structurally valid document was preserved."));
            return Result(input.GeneratedPages.Count, warnings, FidelityValidationStatus.Unavailable, null);
        }

        ShortenRequest? shorten = null;
        if (input.BaselinePages.Count != input.GeneratedPages.Count)
        {
            warnings.Add(new FidelityWarning(
                "PAGE_COUNT_CHANGED",
                "high",
                "Generated page count differs from the template baseline.",
                Details: new Dictionary<string, string>
                {
                    ["baseline"] = input.BaselinePages.Count.ToString(),
                    ["generated"] = input.GeneratedPages.Count.ToString(),
                }));
            if (input.GeneratedPages.Count > input.BaselinePages.Count)
            {
                warnings.Add(new FidelityWarning(
                    "POSSIBLE_OVERFLOW",
                    "high",
                    "Generated content may overflow its intended layout."));
                shorten = CreateShortenRequest(input.Values, input.Mappings);
            }
        }

        var comparablePages = Math.Min(input.BaselinePages.Count, input.GeneratedPages.Count);
        for (var index = 0; index < comparablePages; index++)
        {
            if (ReadPngDimensions(input.BaselinePages[index]) == ReadPngDimensions(input.GeneratedPages[index])) continue;
            warnings.Add(new FidelityWarning(
                "PAGE_DIMENSIONS_CHANGED",
                "high",
                "A generated page has different dimensions from the template baseline.",
                Details: new Dictionary<string, string> { ["page"] = (index + 1).ToString() }));
        }

        var status = warnings.Count == 0 ? FidelityValidationStatus.Passed : FidelityValidationStatus.Warnings;
        return Result(input.GeneratedPages.Count, warnings, status, shorten);
    }

    private static FidelityAssessment Result(
        int pageCount,
        IReadOnlyList<FidelityWarning> warnings,
        FidelityValidationStatus status,
        ShortenRequest? shorten) => new(
            new FidelityReport(status == FidelityValidationStatus.Passed, [], [], pageCount, warnings, status),
            shorten);

    private static ShortenRequest? CreateShortenRequest(
        IReadOnlyDictionary<string, string> values,
        IReadOnlyList<FieldLocator> mappings)
    {
        var mapped = mappings
            .Select(mapping => (mapping.FieldName, Value: values.GetValueOrDefault(mapping.FieldName)))
            .Where(item => !string.IsNullOrEmpty(item.Value))
            .OrderByDescending(item => item.Value!.Length)
            .ThenBy(item => item.FieldName, StringComparer.Ordinal)
            .FirstOrDefault();
        return mapped.Value is null
            ? null
            : new ShortenRequest(mapped.FieldName, Math.Max(1, (int)Math.Floor(mapped.Value.Length * 0.8)));
    }

    private static (int Width, int Height) ReadPngDimensions(string path)
    {
        Span<byte> header = stackalloc byte[24];
        using var stream = File.OpenRead(path);
        if (stream.Read(header) != header.Length ||
            !header[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }))
            throw new InvalidDataException("Rendered page is not a valid PNG");
        return (
            BinaryPrimitives.ReadInt32BigEndian(header.Slice(16, 4)),
            BinaryPrimitives.ReadInt32BigEndian(header.Slice(20, 4)));
    }
}
