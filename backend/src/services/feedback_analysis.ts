/**
 * Feedback Analysis Service
 *
 * Analyzes user edits to documents for the self-learning loop.
 * Provides detailed diff analysis and edit classification.
 */

import { diffLines } from 'diff';
import { jaccardSimilarity, tokenize } from '../utils/feedback_utils';
export { jaccardSimilarity, tokenize };

// ============================================================================
// Types
// ============================================================================

export interface LegalChange {
  kind: 'article' | 'clause' | 'point' | 'citation';
  removed: string[];
  added: string[];
}

export interface FormattingChange {
  kind: 'header' | 'signature_block' | 'date_format' | 'document_number';
  presentInOriginal: boolean;
  presentInEdited: boolean;
}

export interface ChangedLine {
  line: number;
  original: string;
  edited: string;
}

export interface FeedbackDiff {
  additions: string[];
  deletions: string[];
  modifications: string[];
  changedLines: ChangedLine[];
  legalChanges: LegalChange[];
  formattingChanges: FormattingChange[];
  jaccardSimilarity: number;
}

export interface FeedbackClassification {
  primaryType: 'addition' | 'deletion' | 'modification';
  subType: 'formatting' | 'wording' | 'structural' | 'legal' | 'correction';
  priority: 'critical' | 'high' | 'medium' | 'low';
  affectsCompliance: boolean;
  confidence: number;
}

export interface FeedbackAnalysis {
  diff: FeedbackDiff;
  classification: FeedbackClassification;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

export const LEGAL_PATTERNS = {
  article: /(?:^|[\s,;.:])Điều\s+\d+[a-zA-Z]?(?=$|[\s,;.:])/giu, // Điều
  clause: /(?:^|[\s,;.:])Khoản\s+\d+(?:\.\d+)?(?=$|[\s,;.:])/giu, // Khoản
  point: /(?:^|[\s,;.:])Điểm\s+[a-z](?=$|[\s,;.:])/giu, // Điểm
  citation: /(?:^|[\s,;.:])(?:Luật|Nghị định|Thông tư)\s+[\d/]+(?:\/[A-ZĐ-]+)?(?=$|[\s,;.:])/giu,
};

export const FORMAT_PATTERNS = {
  header: /CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM/iu,
  signature_block: /\b(?:CHỦ TỊCH|PHÓ CHỦ TỊCH|Ký tên|đóng dấu)\b/iu,
  date_format: /\bngày\s+\d{1,2}\s+tháng\s+\d{1,2}\s+năm\s+\d{4}\b/iu,
  document_number: /\bSố:\s*[\w/-]+/iu,
};

// ============================================================================
// Helper Functions
// ============================================================================


/**
 * Check if a pattern matches in text
 */
function hasPattern(text: string, pattern: RegExp): boolean {
  const match = text.match(pattern);
  return match !== null;
}

/**
 * Extract all matches of a pattern from text
 */
function extractPatterns(text: string, pattern: RegExp): string[] {
  const matches = text.match(pattern);
  return matches || [];
}

/**
 * Check if content has critical formatting elements removed
 */
function checkFormattingChanges(original: string, edited: string): FormattingChange[] {
  const changes: FormattingChange[] = [];

  // Check header
  const headerOriginal = hasPattern(original, FORMAT_PATTERNS.header);
  const headerEdited = hasPattern(edited, FORMAT_PATTERNS.header);
  changes.push({
    kind: 'header',
    presentInOriginal: headerOriginal,
    presentInEdited: headerEdited,
  });

  // Check signature block
  const sigOriginal = hasPattern(original, FORMAT_PATTERNS.signature_block);
  const sigEdited = hasPattern(edited, FORMAT_PATTERNS.signature_block);
  changes.push({
    kind: 'signature_block',
    presentInOriginal: sigOriginal,
    presentInEdited: sigEdited,
  });

  // Check date format
  const dateOriginal = hasPattern(original, FORMAT_PATTERNS.date_format);
  const dateEdited = hasPattern(edited, FORMAT_PATTERNS.date_format);
  changes.push({
    kind: 'date_format',
    presentInOriginal: dateOriginal,
    presentInEdited: dateEdited,
  });

  // Check document number
  const docNumOriginal = hasPattern(original, FORMAT_PATTERNS.document_number);
  const docNumEdited = hasPattern(edited, FORMAT_PATTERNS.document_number);
  changes.push({
    kind: 'document_number',
    presentInOriginal: docNumOriginal,
    presentInEdited: docNumEdited,
  });

  return changes;
}

/**
 * Detect legal changes between original and edited content
 */
function detectLegalChanges(original: string, edited: string): LegalChange[] {
  const changes: LegalChange[] = [];

  // Check articles (Điều)
  const articlesOriginal = extractPatterns(original, LEGAL_PATTERNS.article);
  const articlesEdited = extractPatterns(edited, LEGAL_PATTERNS.article);
  if (articlesOriginal.length > 0 || articlesEdited.length > 0) {
    const removed = articlesOriginal.filter(a => !articlesEdited.includes(a));
    const added = articlesEdited.filter(a => !articlesOriginal.includes(a));
    if (removed.length > 0 || added.length > 0) {
      changes.push({ kind: 'article', removed, added });
    }
  }

  // Check clauses (Khoản)
  const clausesOriginal = extractPatterns(original, LEGAL_PATTERNS.clause);
  const clausesEdited = extractPatterns(edited, LEGAL_PATTERNS.clause);
  if (clausesOriginal.length > 0 || clausesEdited.length > 0) {
    const removed = clausesOriginal.filter(c => !clausesEdited.includes(c));
    const added = clausesEdited.filter(c => !clausesOriginal.includes(c));
    if (removed.length > 0 || added.length > 0) {
      changes.push({ kind: 'clause', removed, added });
    }
  }

  // Check points (Điểm)
  const pointsOriginal = extractPatterns(original, LEGAL_PATTERNS.point);
  const pointsEdited = extractPatterns(edited, LEGAL_PATTERNS.point);
  if (pointsOriginal.length > 0 || pointsEdited.length > 0) {
    const removed = pointsOriginal.filter(p => !pointsEdited.includes(p));
    const added = pointsEdited.filter(p => !pointsOriginal.includes(p));
    if (removed.length > 0 || added.length > 0) {
      changes.push({ kind: 'point', removed, added });
    }
  }

  // Check citations (Luật, Nghị định, Thông tư)
  const citationsOriginal = extractPatterns(original, LEGAL_PATTERNS.citation);
  const citationsEdited = extractPatterns(edited, LEGAL_PATTERNS.citation);
  if (citationsOriginal.length > 0 || citationsEdited.length > 0) {
    const removed = citationsOriginal.filter(c => !citationsEdited.includes(c));
    const added = citationsEdited.filter(c => !citationsOriginal.includes(c));
    if (removed.length > 0 || added.length > 0) {
      changes.push({ kind: 'citation', removed, added });
    }
  }

  return changes;
}

/**
 * Compute line-based diff using Myers algorithm (via the `diff` package).
 * H2: replaced the naive positional comparison which misidentified shifted
 * lines as modifications rather than additions+deletions. The `diff` package
 * produces a proper minimal edit script with correct add/remove/modify semantics.
 */
function computeLineDiff(original: string, edited: string): {
  additions: string[];
  deletions: string[];
  modifications: ChangedLine[];
} {
  // Normalize trailing newlines — diffLines treats a line with \n as different
  // from one without, so ensure both sides end the same way.
  const normOrig = original.endsWith('\n') ? original : original + '\n';
  const normEdit = edited.endsWith('\n') ? edited : edited + '\n';
  const result = diffLines(normOrig, normEdit);

  const additions: string[] = [];
  const deletions: string[] = [];
  const modifications: ChangedLine[] = [];

  for (let i = 0; i < result.length; i++) {
    const part = result[i];
    const nextPart = result[i + 1];

    if (part.removed && nextPart && nextPart.added) {
      // Adjacent remove+add = modification
      modifications.push({
        line: i + 1,
        original: part.value.trimEnd(),
        edited: nextPart.value.trimEnd(),
      });
      i++; // skip next part (already consumed)
    } else if (part.added) {
      // diffLines groups consecutive same-type lines into one part;
      // split back so each line is a separate entry.
      const lines = part.value.split('\n').filter((l: string) => l.length > 0);
      additions.push(...lines.map((l: string) => l.trimEnd()));
    } else if (part.removed) {
      const lines = part.value.split('\n').filter((l: string) => l.length > 0);
      deletions.push(...lines.map((l: string) => l.trimEnd()));
    }
  }

  return { additions, deletions, modifications };
}

/**
 * Determine primary type based on additions/deletions/modifications
 */
function determinePrimaryType(
  additions: string[],
  deletions: string[],
  modifications: ChangedLine[]
): 'addition' | 'deletion' | 'modification' {
  if (additions.length > deletions.length && deletions.length === 0 && modifications.length === 0) {
    return 'addition';
  }
  if (deletions.length > additions.length && additions.length === 0 && modifications.length === 0) {
    return 'deletion';
  }
  return 'modification';
}

/**
 * Classify the edit based on analysis rules (in priority order)
 */
function classifyEdit(
  diff: FeedbackDiff
): FeedbackClassification {
  const { legalChanges, formattingChanges, additions, deletions, jaccardSimilarity } = diff;

  // Rule 1: Legal changes → critical legal edit
  const hasLegalChanges = legalChanges.some(c => c.removed.length > 0 || c.added.length > 0);
  if (hasLegalChanges) {
    return {
      primaryType: determinePrimaryType(additions, deletions, diff.changedLines),
      subType: 'legal',
      priority: 'critical',
      affectsCompliance: true,
      confidence: 0.95,
    };
  }

  // Rule 2: Critical formatting removed → formatting with high priority
  const criticalFormattingRemoved = formattingChanges.some(
    c => (c.kind === 'header' || c.kind === 'signature_block') &&
         c.presentInOriginal && !c.presentInEdited
  );
  if (criticalFormattingRemoved) {
    return {
      primaryType: determinePrimaryType(additions, deletions, diff.changedLines),
      subType: 'formatting',
      priority: 'high',
      affectsCompliance: true,
      confidence: 0.90,
    };
  }

  // Rule 3: Structural changes (3+ lines added/deleted) → structural with high priority
  const totalLineChanges = additions.length + deletions.length;
  if (totalLineChanges >= 3) {
    return {
      primaryType: determinePrimaryType(additions, deletions, diff.changedLines),
      subType: 'structural',
      priority: 'high',
      affectsCompliance: false,
      confidence: 0.85,
    };
  }

  // Rule 4: Minor corrections (similarity >= 0.95) → correction with low priority
  if (jaccardSimilarity >= 0.95) {
    return {
      primaryType: determinePrimaryType(additions, deletions, diff.changedLines),
      subType: 'correction',
      priority: 'low',
      affectsCompliance: false,
      confidence: 0.90,
    };
  }

  // Rule 5: Formatting only → formatting with low priority
  const hasOnlyFormattingChanges =
    additions.length === 0 &&
    deletions.length === 0 &&
    diff.changedLines.length === 0 &&
    formattingChanges.some(c => c.presentInOriginal !== c.presentInEdited);
  if (hasOnlyFormattingChanges) {
    return {
      primaryType: 'modification',
      subType: 'formatting',
      priority: 'low',
      affectsCompliance: false,
      confidence: 0.80,
    };
  }

  // Rule 6: Default → wording with medium priority
  return {
    primaryType: determinePrimaryType(additions, deletions, diff.changedLines),
    subType: 'wording',
    priority: 'medium',
    affectsCompliance: false,
    confidence: 0.70,
  };
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Analyze feedback between original and edited content
 *
 * @param originalContent - Original document content
 * @param editedContent - Edited document content
 * @returns FeedbackAnalysis with diff and classification
 * @throws Error if content is too short
 */
export function analyzeFeedback(
  originalContent: string,
  editedContent: string
): FeedbackAnalysis {
  // Validate content length
  const MIN_CONTENT_LENGTH = 10;
  if (originalContent.length < MIN_CONTENT_LENGTH) {
    throw new Error(
      `Original content too short (length: ${originalContent.length}, minimum: ${MIN_CONTENT_LENGTH})`
    );
  }
  if (editedContent.length < MIN_CONTENT_LENGTH) {
    throw new Error(
      `Edited content too short (length: ${editedContent.length}, minimum: ${MIN_CONTENT_LENGTH})`
    );
  }

  // Compute line-based diff
  const lineDiff = computeLineDiff(originalContent, editedContent);

  // Detect formatting changes
  const formattingChanges = checkFormattingChanges(originalContent, editedContent);

  // Detect legal changes
  const legalChanges = detectLegalChanges(originalContent, editedContent);

  // Calculate similarity score using Jaccard
  const jaccardScore = jaccardSimilarity(originalContent, editedContent);

  // Build diff object
  const diff: FeedbackDiff = {
    additions: lineDiff.additions,
    deletions: lineDiff.deletions,
    modifications: [],
    changedLines: lineDiff.modifications,
    legalChanges,
    formattingChanges,
 jaccardSimilarity: jaccardScore,
  };

  // Fix modifications format - extract just the text
  diff.modifications = lineDiff.modifications.map(m =>
    `Line ${m.line}: "${m.original}" → "${m.edited}"`
  );

  // Classify the edit
  const classification = classifyEdit(diff);

  return { diff, classification };
}

// Export for testing
export const feedbackAnalysis = {
  tokenize,
  jaccardSimilarity,
  analyzeFeedback,
  LEGAL_PATTERNS,
  FORMAT_PATTERNS,
};