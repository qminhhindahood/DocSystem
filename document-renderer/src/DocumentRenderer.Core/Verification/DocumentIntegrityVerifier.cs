using System.IO.Compression;
using System.Security.Cryptography;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Verification;

public sealed class DocumentIntegrityException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public sealed class DocumentIntegrityVerifier
{
    public void VerifyOrThrow(
        string originalPath,
        string outputPath,
        StructuralAnalysis before,
        StructuralAnalysis after,
        IReadOnlyList<FidelityViolation> insertionViolations)
    {
        if (insertionViolations.FirstOrDefault() is { } insertionFailure)
            throw new DocumentIntegrityException(insertionFailure.Code, insertionFailure.Message);

        var beforeByLocator = before.Candidates.ToDictionary(candidate => candidate.Locator, StringComparer.Ordinal);
        var afterByLocator = after.Candidates.ToDictionary(candidate => candidate.Locator, StringComparer.Ordinal);
        if (!beforeByLocator.Keys.ToHashSet(StringComparer.Ordinal).SetEquals(afterByLocator.Keys))
            throw new DocumentIntegrityException("STRUCTURE_CHANGED", "Editable document structure changed during generation");

        foreach (var (locator, candidate) in beforeByLocator)
        {
            var output = afterByLocator[locator];
            if (candidate.Fingerprint?.GetValueOrDefault("sha256") is { } expectedShape &&
                !string.Equals(output.Fingerprint?.GetValueOrDefault("sha256"), expectedShape, StringComparison.Ordinal))
                throw new DocumentIntegrityException("SHAPE_GEOMETRY_CHANGED", $"Floating shape changed: {locator}");
        }

        VerifyStaticPackageParts(originalPath, outputPath);
    }

    private static void VerifyStaticPackageParts(string originalPath, string outputPath)
    {
        using var before = ZipFile.OpenRead(originalPath);
        using var after = ZipFile.OpenRead(outputPath);
        var beforeParts = StaticParts(before);
        var afterParts = StaticParts(after);
        if (!beforeParts.Keys.ToHashSet(StringComparer.OrdinalIgnoreCase).SetEquals(afterParts.Keys))
            throw new DocumentIntegrityException("STATIC_PART_CHANGED", "Immutable package parts changed during generation");

        foreach (var (name, expectedHash) in beforeParts)
            if (!CryptographicOperations.FixedTimeEquals(expectedHash, afterParts[name]))
                throw new DocumentIntegrityException("STATIC_PART_CHANGED", $"Immutable package part changed: {name}");
    }

    private static Dictionary<string, byte[]> StaticParts(ZipArchive archive) => archive.Entries
        .Where(entry => !IsEditableXmlPart(entry.FullName))
        .ToDictionary(entry => entry.FullName, HashEntry, StringComparer.OrdinalIgnoreCase);

    private static bool IsEditableXmlPart(string name) =>
        string.Equals(name, "word/document.xml", StringComparison.OrdinalIgnoreCase) ||
        name.StartsWith("word/header", StringComparison.OrdinalIgnoreCase) ||
        name.StartsWith("word/footer", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(name, "word/footnotes.xml", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(name, "word/endnotes.xml", StringComparison.OrdinalIgnoreCase);

    private static byte[] HashEntry(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        return SHA256.HashData(stream);
    }
}
