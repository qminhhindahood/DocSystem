using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Contracts;

namespace DocumentRenderer.Core.Editing;

public sealed class SemanticInserter
{
    public IReadOnlyList<FidelityViolation> Insert(string path, IReadOnlyDictionary<string, object?> values, IReadOnlyList<FieldLocator> mappings)
    {
        var violations = new List<FidelityViolation>();
        using var document = WordprocessingDocument.Open(path, true);
        var locations = StructuralAnalyzer.LocateEditableElements(document);
        foreach (var mapping in mappings)
        {
            if (!locations.TryGetValue(mapping.Locator, out var target) || target is not Paragraph paragraph)
            {
                violations.Add(new("LOCATOR_NOT_FOUND", mapping.FieldName, "Mapped structural location no longer exists"));
                continue;
            }
            if (!values.TryGetValue(mapping.FieldName, out var raw))
            {
                violations.Add(new("UNSET_FIELD", mapping.FieldName, "No semantic value was supplied"));
                continue;
            }
            var value = ToText(raw);
            var texts = paragraph.Descendants<Text>().ToList();
            if (texts.Count == 0)
            {
                paragraph.AppendChild(new Run(new Text(value) { Space = SpaceProcessingModeValues.Preserve }));
            }
            else
            {
                texts[0].Text = value;
                texts[0].Space = SpaceProcessingModeValues.Preserve;
                foreach (var text in texts.Skip(1)) text.Text = "";
            }
        }
        document.MainDocumentPart?.Document?.Save();
        foreach (var header in document.MainDocumentPart?.HeaderParts ?? []) header.Header?.Save();
        foreach (var footer in document.MainDocumentPart?.FooterParts ?? []) footer.Footer?.Save();
        return violations;
    }

    private static string ToText(object? value) => value switch
    {
        null => "",
        System.Text.Json.JsonElement json when json.ValueKind == System.Text.Json.JsonValueKind.Array =>
            string.Join(Environment.NewLine, json.EnumerateArray().Select(e => e.ToString())),
        System.Text.Json.JsonElement json => json.ToString(),
        IEnumerable<string> values => string.Join(Environment.NewLine, values),
        _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? "",
    };
}
