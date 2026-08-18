namespace DocumentRenderer.Core.Contracts;

public sealed record PackageValidationReport(bool Valid, string Code, long FileSize, string Sha256, IReadOnlyList<string> Warnings);
public sealed record ResolvedTextStyle(string FontFamily, double? FontSizePoints, bool Bold, bool Italic, string Color);
public sealed record CandidateFormatting(bool InTextBox, IReadOnlyList<ResolvedTextStyle> Styles);
public sealed record StructuralCandidate(
    string Locator,
    string Kind,
    IReadOnlyDictionary<string, string>? Fingerprint,
    string TextSnippet,
    CandidateFormatting? Formatting = null);
public sealed record StructuralAnalysis(string DocumentFingerprint, IReadOnlyList<StructuralCandidate> Candidates, IReadOnlyList<string> Compatibility);
public sealed record FieldLocator(string FieldName, string Locator);
public sealed record FidelityViolation(string Code, string? Field, string Message);
public sealed record AppliedRepair(string Policy, string Field);
public enum FidelityValidationStatus { Passed, Warnings, Unavailable }
public sealed record FidelityWarning(
    string Code,
    string Severity,
    string Message,
    string? Field = null,
    IReadOnlyDictionary<string, string>? Details = null);
public sealed record FidelityReport(
    bool Passed,
    IReadOnlyList<FidelityViolation> Violations,
    IReadOnlyList<AppliedRepair> Repairs,
    int PageCount,
    IReadOnlyList<FidelityWarning> Warnings,
    FidelityValidationStatus ValidationStatus)
{
    public FidelityReport(
        bool passed,
        IReadOnlyList<FidelityViolation> violations,
        IReadOnlyList<AppliedRepair> repairs,
        int pageCount)
        : this(passed, violations, repairs, pageCount, [], FidelityValidationStatus.Passed) { }
}

public sealed record AnalyzeDocumentRequest(string TemplateId, string RelativePath, string Sha256);
public sealed record AnalyzeDocumentResponse(bool Success, string DocumentFingerprint, IReadOnlyList<StructuralCandidate> Candidates, IReadOnlyList<string> BaselinePages, IReadOnlyList<string> LabeledPages, IReadOnlyList<string> Compatibility);
public sealed record RenderDocumentRequest(string TemplateId, string OwnerId, string DocumentId, string RelativePath, IReadOnlyDictionary<string, object?> Values, IReadOnlyList<FieldLocator> Mappings);
public sealed record RenderDocumentResponse(bool Success, string? OutputRelativePath, string? OutputSha256, long? OutputSize, FidelityReport FidelityReport, ShortenRequest? ShortenRequired = null);
public sealed record ShortenRequest(string Field, int MaxCharacters);
