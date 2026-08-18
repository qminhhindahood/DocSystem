using System.Security.Cryptography;
using System.Text;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Analysis;

public sealed class StructuralAnalyzer
{
    private readonly TextFormattingResolver _formattingResolver = new();

    public StructuralAnalysis Analyze(string path)
    {
        using var document = WordprocessingDocument.Open(path, false);
        var candidates = new List<StructuralCandidate>();
        var compatibility = new List<string>();
        foreach (var (partUri, root) in EnumerateRoots(document))
        {
            foreach (var unsupported in root.Descendants().Where(IsUnsupportedStructure))
                compatibility.Add($"Unsupported:{unsupported.LocalName}:{partUri}:{BuildPath(unsupported)}");
            foreach (var paragraph in root.Descendants<Paragraph>())
            {
                if (IsInactiveAlternateContentBranch(paragraph)) continue;
                var ownText = OwnText(paragraph);
                if (ownText.Length == 0 && paragraph.Descendants<Paragraph>().Any()) continue;
                var inTextBox = paragraph.Ancestors().Any(e => e.LocalName == "txbxContent");
                var locator = $"{partUri}::{BuildPath(paragraph)}";
                var shape = paragraph.Ancestors().Where(IsFloatingShape).LastOrDefault();
                candidates.Add(new(locator, inTextBox ? "FLOATING_TEXT_BOX" : PartKind(partUri),
                    shape is null ? null : ShapeFingerprint(shape), Clip(ownText),
                    _formattingResolver.Resolve(document, paragraph, inTextBox)));
            }
        }
        var fingerprintSource = string.Join('\n', candidates.OrderBy(c => c.Locator)
            .Select(c => $"{c.Locator}|{c.Kind}|{c.Fingerprint?.GetValueOrDefault("sha256", "")}"));
        return new(Sha256(fingerprintSource), candidates, compatibility);
    }

    public static IReadOnlyDictionary<string, OpenXmlElement> LocateEditableElements(WordprocessingDocument document)
    {
        var result = new Dictionary<string, OpenXmlElement>(StringComparer.Ordinal);
        foreach (var (partUri, root) in EnumerateRoots(document))
            foreach (var paragraph in root.Descendants<Paragraph>())
            {
                if (IsInactiveAlternateContentBranch(paragraph)) continue;
                result[$"{partUri}::{BuildPath(paragraph)}"] = paragraph;
            }
        return result;
    }

    private static IEnumerable<(string Uri, OpenXmlElement Root)> EnumerateRoots(WordprocessingDocument document)
    {
        var main = document.MainDocumentPart ?? throw new InvalidDataException("DOCX has no main document part");
        if (main.Document is not null) yield return (main.Uri.ToString(), main.Document);
        foreach (var part in main.HeaderParts) if (part.Header is not null) yield return (part.Uri.ToString(), part.Header);
        foreach (var part in main.FooterParts) if (part.Footer is not null) yield return (part.Uri.ToString(), part.Footer);
        if (main.FootnotesPart?.Footnotes is not null) yield return (main.FootnotesPart.Uri.ToString(), main.FootnotesPart.Footnotes);
        if (main.EndnotesPart?.Endnotes is not null) yield return (main.EndnotesPart.Uri.ToString(), main.EndnotesPart.Endnotes);
    }

    private static string BuildPath(OpenXmlElement element)
    {
        var segments = new Stack<string>();
        for (OpenXmlElement? current = element; current?.Parent is not null; current = current.Parent)
        {
            var index = current.Parent.ChildElements
                .TakeWhile(child => !ReferenceEquals(child, current))
                .Count(child => child.LocalName == current.LocalName) + 1;
            segments.Push($"{current.LocalName}[{index}]");
        }
        return "/" + string.Join('/', segments);
    }

    private static bool IsFloatingShape(OpenXmlElement element) => element.LocalName is "anchor" or "shape" or "group" or "grpSp" or "wgp";

    private static bool IsUnsupportedStructure(OpenXmlElement element) => element.LocalName is "canvas" or "relIds" or "control";

    private static bool IsInactiveAlternateContentBranch(OpenXmlElement element)
    {
        var branch = element.Ancestors().FirstOrDefault(ancestor => ancestor.LocalName is "Choice" or "Fallback");
        if (branch?.Parent?.LocalName != "AlternateContent") return false;
        var choices = branch.Parent.ChildElements.Where(child => child.LocalName == "Choice").ToList();
        if (choices.Count == 0) return false;
        return branch.LocalName == "Fallback" || !ReferenceEquals(branch, choices[0]);
    }

    private static IReadOnlyDictionary<string, string> ShapeFingerprint(OpenXmlElement shape)
    {
        var clone = shape.CloneNode(true);
        foreach (var text in clone.Descendants().Where(e => e.LocalName == "t").ToList())
            text.Remove();
        return new Dictionary<string, string> {
            ["kind"] = shape.LocalName,
            ["sha256"] = Sha256(clone.OuterXml),
        };
    }

    private static string PartKind(string uri) => uri.Contains("header", StringComparison.OrdinalIgnoreCase)
        ? "HEADER_PARAGRAPH" : uri.Contains("footer", StringComparison.OrdinalIgnoreCase)
        ? "FOOTER_PARAGRAPH" : "BODY_PARAGRAPH";
    private static string OwnText(Paragraph paragraph) => string.Concat(
        paragraph.Descendants<Text>()
            .Where(text => ReferenceEquals(text.Ancestors<Paragraph>().FirstOrDefault(), paragraph))
            .Select(text => text.Text));
    private static string Clip(string value) => value.Length <= 200 ? value : value[..200];
    private static string Sha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
}
