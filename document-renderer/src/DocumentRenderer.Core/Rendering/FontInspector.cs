using System.IO.Compression;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using DocumentRenderer.Core.Configuration;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Processes;

namespace DocumentRenderer.Core.Rendering;

public sealed record FontInspectionResult(
    IReadOnlyList<string> DeclaredFonts,
    IReadOnlyList<FidelityWarning> Warnings);

public sealed partial class FontInspector(
    RendererOptions options,
    IExternalProcessRunner processRunner)
{
    private static readonly HashSet<string> FontAttributeNames = new(StringComparer.Ordinal)
    {
        "ascii", "hAnsi", "eastAsia", "cs", "typeface",
    };

    public IReadOnlyList<string> ExtractDeclaredFonts(string packagePath)
    {
        var fonts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var archive = ZipFile.OpenRead(packagePath);
        foreach (var entry in archive.Entries.Where(IsFontBearingPart))
        {
            using var stream = entry.Open();
            using var reader = XmlReader.Create(stream, new XmlReaderSettings
            {
                DtdProcessing = DtdProcessing.Prohibit,
                XmlResolver = null,
                MaxCharactersInDocument = 16L * 1024 * 1024,
            });
            var document = XDocument.Load(reader, LoadOptions.None);
            foreach (var value in document.Root!.DescendantsAndSelf()
                         .Attributes()
                         .Where(attribute => FontAttributeNames.Contains(attribute.Name.LocalName))
                         .Select(attribute => NormalizeFamily(attribute.Value))
                         .Where(value => value.Length > 0 && !value.StartsWith('+')))
                fonts.Add(value);
        }
        return fonts.OrderBy(value => value, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    public async Task<FontInspectionResult> InspectAsync(string packagePath, CancellationToken cancellationToken)
    {
        var fonts = ExtractDeclaredFonts(packagePath);
        var warnings = new List<FidelityWarning>();
        foreach (var requested in fonts)
        {
            ProcessResult result;
            try
            {
                result = await processRunner.RunAsync(new ProcessRequest(
                    options.FontMatchExecutable,
                    ["--format=%{family}\\n", requested],
                    options.TempRoot,
                    options.RenderTimeout), cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch
            {
                warnings.Add(Unavailable(requested));
                continue;
            }

            var resolved = result.StandardOutput
                .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(line => line.Split(',', 2, StringSplitOptions.TrimEntries)[0])
                .Select(NormalizeFamily)
                .FirstOrDefault(value => value.Length > 0);
            if (result.TimedOut || result.ExitCode != 0 || string.IsNullOrEmpty(resolved))
            {
                warnings.Add(Unavailable(requested));
                continue;
            }
            if (!string.Equals(requested, resolved, StringComparison.OrdinalIgnoreCase))
            {
                warnings.Add(new FidelityWarning(
                    "FONT_SUBSTITUTED",
                    "warning",
                    "A document font was replaced by an available free font.",
                    Details: new Dictionary<string, string>
                    {
                        ["requested"] = requested,
                        ["resolved"] = resolved,
                    }));
            }
        }
        return new FontInspectionResult(fonts, warnings);
    }

    private static bool IsFontBearingPart(ZipArchiveEntry entry)
    {
        var path = entry.FullName.Replace('\\', '/');
        if (!path.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)) return false;
        return path is "word/document.xml" or "word/styles.xml" or "word/numbering.xml" or
            "word/footnotes.xml" or "word/endnotes.xml" ||
            path.StartsWith("word/header", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("word/footer", StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith("word/theme/", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeFamily(string value) => Whitespace().Replace(value.Trim(), " ");

    private static FidelityWarning Unavailable(string requested) => new(
        "FONT_VALIDATION_UNAVAILABLE",
        "warning",
        "Font availability could not be verified.",
        Details: new Dictionary<string, string> { ["requested"] = requested });

    [GeneratedRegex("\\s+", RegexOptions.CultureInvariant)]
    private static partial Regex Whitespace();
}
