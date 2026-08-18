using System.Globalization;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Analysis;

public sealed class TextFormattingResolver
{
    public CandidateFormatting Resolve(
        WordprocessingDocument document,
        Paragraph paragraph,
        bool inTextBox)
    {
        var styles = paragraph.Elements<Run>()
            .Where(run => run.Descendants<Text>().Any(text => !string.IsNullOrWhiteSpace(text.Text)))
            .Select(run => ResolveRun(document, paragraph, run))
            .Distinct()
            .ToArray();
        return new CandidateFormatting(inTextBox, styles);
    }

    private static ResolvedTextStyle ResolveRun(
        WordprocessingDocument document,
        Paragraph paragraph,
        Run run)
    {
        var sources = PropertySources(document, paragraph, run).ToArray();
        var font = First(sources, source => FontFamily(document, source)) ?? string.Empty;
        var halfPoints = First(sources, source => source.GetFirstChild<FontSize>()?.Val?.Value);
        var size = double.TryParse(halfPoints, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var parsed)
            ? parsed / 2d
            : (double?)null;
        var bold = First(sources, source => OnOff(source.GetFirstChild<Bold>())) ?? false;
        var italic = First(sources, source => OnOff(source.GetFirstChild<Italic>())) ?? false;
        var color = First(sources, source => source.GetFirstChild<Color>()?.Val?.Value) ?? "000000";
        if (string.Equals(color, "auto", StringComparison.OrdinalIgnoreCase)) color = "000000";
        return new ResolvedTextStyle(font.Trim(), size, bold, italic, color.ToUpperInvariant());
    }

    private static IEnumerable<OpenXmlElement> PropertySources(
        WordprocessingDocument document,
        Paragraph paragraph,
        Run run)
    {
        if (run.RunProperties is not null) yield return run.RunProperties;
        var styles = document.MainDocumentPart?.StyleDefinitionsPart?.Styles;
        if (styles is not null)
        {
            var characterStyle = run.RunProperties?.RunStyle?.Val?.Value;
            foreach (var properties in StyleProperties(styles, characterStyle)) yield return properties;
            var paragraphStyle = paragraph.ParagraphProperties?.ParagraphStyleId?.Val?.Value;
            foreach (var properties in StyleProperties(styles, paragraphStyle)) yield return properties;
            var defaults = styles.DocDefaults?.RunPropertiesDefault?.RunPropertiesBaseStyle;
            if (defaults is not null) yield return defaults;
        }
    }

    private static IEnumerable<OpenXmlElement> StyleProperties(Styles styles, string? styleId)
    {
        var visited = new HashSet<string>(StringComparer.Ordinal);
        while (!string.IsNullOrWhiteSpace(styleId) && visited.Add(styleId))
        {
            var style = styles.Elements<Style>().FirstOrDefault(item => item.StyleId?.Value == styleId);
            if (style is null) yield break;
            if (style.StyleRunProperties is not null) yield return style.StyleRunProperties;
            styleId = style.BasedOn?.Val?.Value;
        }
    }

    private static string? FontFamily(WordprocessingDocument document, OpenXmlElement source)
    {
        var fonts = source.GetFirstChild<RunFonts>();
        if (fonts is null) return null;
        var declared = fonts.Ascii?.Value ?? fonts.HighAnsi?.Value ?? fonts.EastAsia?.Value ?? fonts.ComplexScript?.Value;
        if (!string.IsNullOrWhiteSpace(declared)) return declared;
        var themeValue = fonts.AsciiTheme?.Value.ToString()
            ?? fonts.HighAnsiTheme?.Value.ToString()
            ?? fonts.EastAsiaTheme?.Value.ToString()
            ?? fonts.ComplexScriptTheme?.Value.ToString();
        if (string.IsNullOrWhiteSpace(themeValue)) return null;
        var scheme = document.MainDocumentPart?.ThemePart?.Theme?.ThemeElements?.FontScheme;
        var typeface = themeValue.StartsWith("Major", StringComparison.OrdinalIgnoreCase)
            ? scheme?.MajorFont?.LatinFont?.Typeface?.Value
            : scheme?.MinorFont?.LatinFont?.Typeface?.Value;
        return string.IsNullOrWhiteSpace(typeface) ? null : typeface;
    }

    private static bool? OnOff(OnOffType? property) => property is null
        ? null
        : property.Val?.Value ?? true;

    private static T? First<T>(IEnumerable<OpenXmlElement> sources, Func<OpenXmlElement, T?> read)
    {
        foreach (var source in sources)
        {
            var value = read(source);
            if (value is not null) return value;
        }
        return default;
    }
}
