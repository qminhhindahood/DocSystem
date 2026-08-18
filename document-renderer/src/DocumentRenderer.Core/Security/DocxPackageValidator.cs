using System.IO.Compression;
using System.Security.Cryptography;
using System.Xml;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Security;

public sealed class DocxPackageValidator
{
    private const long MaxFileSize = 20L * 1024 * 1024;
    private const long MaxExpandedSize = 100L * 1024 * 1024;
    private const int MaxEntries = 5_000;
    private const double MaxRatio = 100d;

    public async Task<PackageValidationReport> ValidateAsync(string path, CancellationToken cancellationToken = default)
    {
        var info = new FileInfo(path);
        await using var hashInput = File.OpenRead(path);
        var sha = Convert.ToHexString(await SHA256.HashDataAsync(hashInput, cancellationToken)).ToLowerInvariant();
        if (info.Length > MaxFileSize) return Invalid("FILE_TOO_LARGE", info.Length, sha);

        try
        {
            using var archive = ZipFile.OpenRead(path);
            if (archive.Entries.Count > MaxEntries) return Invalid("ZIP_LIMIT_EXCEEDED", info.Length, sha);
            var names = archive.Entries.Select(e => e.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (!names.Contains("[Content_Types].xml") || !names.Contains("word/document.xml"))
                return Invalid("NOT_DOCX", info.Length, sha);
            if (names.Any(n => n.EndsWith("vbaProject.bin", StringComparison.OrdinalIgnoreCase)))
                return Invalid("MACRO_ENABLED", info.Length, sha);
            if (names.Any(n => n.Contains("/activeX/", StringComparison.OrdinalIgnoreCase)
                || n.Contains("/embeddings/", StringComparison.OrdinalIgnoreCase)))
                return Invalid("EMBEDDED_OBJECT", info.Length, sha);

            long expanded = 0;
            foreach (var entry in archive.Entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (Path.IsPathRooted(entry.FullName)
                    || entry.FullName.Split('/').Any(segment => segment is ".." or "."))
                    return Invalid("ZIP_PATH_TRAVERSAL", info.Length, sha);
                expanded = checked(expanded + entry.Length);
                if (expanded > MaxExpandedSize) return Invalid("ZIP_LIMIT_EXCEEDED", info.Length, sha);
                if (entry.Length > 0 && (entry.CompressedLength == 0 || entry.Length / (double)entry.CompressedLength > MaxRatio))
                    return Invalid("ZIP_LIMIT_EXCEEDED", info.Length, sha);
                if (entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase)
                    && HasUnsafeRelationship(entry))
                    return Invalid("EXTERNAL_RELATIONSHIP", info.Length, sha);
            }
            return new(true, "OK", info.Length, sha, []);
        }
        catch (InvalidDataException)
        {
            return Invalid("NOT_DOCX", info.Length, sha);
        }
        catch (XmlException)
        {
            return Invalid("INVALID_RELATIONSHIPS", info.Length, sha);
        }
    }

    private static bool HasUnsafeRelationship(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
        while (reader.Read())
        {
            if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "Relationship") continue;
            var mode = reader.GetAttribute("TargetMode");
            var type = reader.GetAttribute("Type") ?? "";
            if (string.Equals(mode, "External", StringComparison.OrdinalIgnoreCase)
                || type.Contains("oleObject", StringComparison.OrdinalIgnoreCase)
                || type.Contains("activeX", StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static PackageValidationReport Invalid(string code, long size, string sha) =>
        new(false, code, size, sha, [code]);
}
