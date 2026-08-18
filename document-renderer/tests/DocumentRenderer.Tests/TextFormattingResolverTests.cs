using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using DocumentRenderer.Core.Analysis;
using DocumentRenderer.Core.Contracts;
using DocumentRenderer.Core.Editing;
using A = DocumentFormat.OpenXml.Drawing;
using DW = DocumentFormat.OpenXml.Drawing.Wordprocessing;
using Vml = DocumentFormat.OpenXml.Vml;
using Wps = DocumentFormat.OpenXml.Office2010.Word.DrawingShape;
using Xunit;

namespace DocumentRenderer.Tests;

public sealed class TextFormattingResolverTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"formatting-tests-{Guid.NewGuid():N}");

    public TextFormattingResolverTests() => Directory.CreateDirectory(_root);
    public void Dispose() => Directory.Delete(_root, true);

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void AnalyzerResolvesCompliantTypographyInsideAndOutsideTextBoxes(bool inTextBox)
    {
        var paragraph = new Paragraph(new Run(
            new RunProperties(
                new RunFonts { Ascii = "Times New Roman", HighAnsi = "Times New Roman" },
                new FontSize { Val = "28" },
                new Bold(),
                new Color { Val = "000000" }),
            new Text("NỘI DUNG")));
        var path = CreateDocument(paragraph, inTextBox);

        var candidate = Assert.Single(new StructuralAnalyzer().Analyze(path).Candidates,
            item => item.TextSnippet == "NỘI DUNG");

        Assert.Equal(inTextBox, candidate.Formatting!.InTextBox);
        var style = Assert.Single(candidate.Formatting.Styles);
        Assert.Equal("Times New Roman", style.FontFamily);
        Assert.Equal(14, style.FontSizePoints);
        Assert.True(style.Bold);
        Assert.False(style.Italic);
        Assert.Equal("000000", style.Color);
    }

    [Fact]
    public void AnalyzerResolvesParagraphStyleInheritance()
    {
        var paragraph = new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = "BodyStyle" }),
            new Run(new Text("Nội dung kế thừa")));
        var path = CreateDocument(paragraph, false, main =>
        {
            var stylesPart = main.AddNewPart<StyleDefinitionsPart>();
            stylesPart.Styles = new Styles(
                new Style(
                    new StyleName { Val = "Body style" },
                    new StyleRunProperties(
                        new RunFonts { Ascii = "Times New Roman", HighAnsi = "Times New Roman" },
                        new FontSize { Val = "26" },
                        new Italic(),
                        new Color { Val = "auto" }))
                { Type = StyleValues.Paragraph, StyleId = "BodyStyle" });
            stylesPart.Styles.Save();
        });

        var candidate = Assert.Single(new StructuralAnalyzer().Analyze(path).Candidates,
            item => item.TextSnippet == "Nội dung kế thừa");
        var style = Assert.Single(candidate.Formatting!.Styles);

        Assert.Equal("Times New Roman", style.FontFamily);
        Assert.Equal(13, style.FontSizePoints);
        Assert.False(style.Bold);
        Assert.True(style.Italic);
        Assert.Equal("000000", style.Color);
    }

    [Fact]
    public void SemanticInsertionPreservesDrawingMlTextBoxGeometryAndTypography()
    {
        var textBoxParagraph = new Paragraph(new Run(
            new RunProperties(
                new RunFonts { Ascii = "Times New Roman", HighAnsi = "Times New Roman" },
                new FontSize { Val = "28" },
                new Color { Val = "000000" }),
            new Text("ORIGINAL")));
        var shape = new Wps.WordprocessingShape(
            new Wps.TextBoxInfo2(new TextBoxContent(textBoxParagraph)));
        var graphicData = new A.GraphicData(shape)
        {
            Uri = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
        };
        var anchor = new DW.Anchor(new A.Graphic(graphicData))
        {
            BehindDoc = false,
            LayoutInCell = true,
            AllowOverlap = true,
        };
        var path = CreateDrawingDocument(new Drawing(anchor));
        var analyzer = new StructuralAnalyzer();
        var before = analyzer.Analyze(path);
        var candidate = Assert.Single(before.Candidates, item => item.Kind == "FLOATING_TEXT_BOX");

        var violations = new SemanticInserter().Insert(path,
            new Dictionary<string, object?> { ["subject"] = "REPLACED" },
            [new FieldLocator("subject", candidate.Locator)]);

        Assert.Empty(violations);
        var after = Assert.Single(analyzer.Analyze(path).Candidates, item => item.Locator == candidate.Locator);
        Assert.Equal(candidate.Fingerprint!["sha256"], after.Fingerprint!["sha256"]);
        Assert.Equal("REPLACED", after.TextSnippet);
        Assert.Equal("Times New Roman", Assert.Single(after.Formatting!.Styles).FontFamily);
    }

    private string CreateDocument(
        Paragraph paragraph,
        bool inTextBox,
        Action<MainDocumentPart>? configure = null)
    {
        var path = Path.Combine(_root, $"{Guid.NewGuid():N}.docx");
        using var package = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var main = package.AddMainDocumentPart();
        configure?.Invoke(main);
        if (inTextBox)
        {
            var shape = new Vml.Shape(new Vml.TextBox(new TextBoxContent(paragraph))) { Id = "shape1" };
            main.Document = new Document(new Body(new Paragraph(new Run(new Picture(shape)))));
        }
        else
        {
            main.Document = new Document(new Body(paragraph));
        }
        main.Document.Save();
        return path;
    }

    private string CreateDrawingDocument(Drawing drawing)
    {
        var path = Path.Combine(_root, $"{Guid.NewGuid():N}.docx");
        using var package = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var main = package.AddMainDocumentPart();
        main.Document = new Document(new Body(new Paragraph(new Run(drawing))));
        main.Document.Save();
        return path;
    }
}
