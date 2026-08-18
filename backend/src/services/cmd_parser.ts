/**
 * Command Parser — extracts intent and entities from Vietnamese gov prompts.
 * Lightweight regex-based parser that doesn't require LLM calls.
 */

import { DOCUMENT_TYPE_DEFINITIONS, DOCUMENT_TYPE_IDS } from '../constants/document-types';

export interface ParsedCommand {
  intent: 'create' | 'modify' | 'revoke' | 'report' | 'notify' | 'issue' | 'unknown';
  docType?: string;
  entities: {
    agency?: string;
    subject?: string;
    legalBasis?: string[];
    targetPerson?: string;
    dateVn?: string;
    place?: string;
  };
  rawPrompt: string;
}

const INTENT_PATTERNS: Record<string, RegExp[]> = {
  create: [
    /(vi[ếe]t|so[aạ]n|t[aạ]o|l[aậ]p|ban h[aà]nh)/i,
    /(so[aạ]n th[aả]o)/i,
    /(t[aạ]o v[ăa]n b[aả]n)/i,
  ],
  modify: [
    /(s[ửu]a|ch[ỉi]nh s[ửu]a|đi[eề]u ch[ỉi]nh|b[ổo] sung)/i,
  ],
  revoke: [
    /(b[ãa]i b[ỏo]|h[uủ]y|thu h[ồo]i)/i,
  ],
  report: [
    /(b[aá]o c[aá]o|t[ổo]ng h[ợo]p|th[ốo]ng k[êe])/i,
  ],
  notify: [
    /(th[ôo]ng b[aá]o|ph[ổo] bi[ếe]n|truy[eề]n [đđ][aạ]t)/i,
  ],
  issue: [
    /(ban h[aà]nh|ph[aá]t h[aà]nh|ra quy[eế]t [đđ][ịi]nh)/i,
  ],
};

const normalizeVietnamese = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLocaleLowerCase('vi-VN');

const DOCTYPE_MATCHERS = DOCUMENT_TYPE_IDS
  .flatMap(id => DOCUMENT_TYPE_DEFINITIONS[id].aliases.map(alias => ({
    id,
    alias: normalizeVietnamese(alias),
  })))
  .sort((a, b) => b.alias.length - a.alias.length);

const ENTITY_PATTERNS = {
  agency: /(B[ộO]\s+[A-ZĐ][a-zA-ZÀ-ỹđĐ\s]+|S[ởỞ]\s+[A-ZĐ][a-zA-ZÀ-ỹđĐ\s]+|UBND\s+[a-zA-ZÀ-ỹđĐ\s]+)/i,
  subject: /V\/v\s+(.+?)(?:\s*\.|\s*$)/i,
  targetPerson: /([Ôo]ng|[Bb]à)\s+([A-ZĐ][a-zA-ZÀ-ỹđĐ]+(?:\s+[A-ZĐ][a-zA-ZÀ-ỹđĐ]+)+)/,
  dateVn: /ng[aà]y\s+(\d{1,2})\s+th[aá]ng\s+(\d{1,2})\s+n[ăa]m\s+(\d{4})/i,
  place: /t[aạ]i\s+([A-ZĐ][a-zA-ZÀ-ỹđĐ]+(?:\s+[A-ZĐ][a-zA-ZÀ-ỹđĐ]+)*)/i,
  legalBasis: /(?:C[ăa]n c[ứu]|theo)\s+(Lu[ậa]t|Ngh[ịi] [đđ][ịi]nh|Th[ôo]ng t[ưu])\s+[a-zA-ZÀ-ỹđĐ0-9\/\s,-]+/gi,
};

export function parseCommand(prompt: string): ParsedCommand {
  const result: ParsedCommand = {
    intent: 'unknown',
    entities: {},
    rawPrompt: prompt,
  };

  // Intent detection — first match wins (ordered by specificity)
  // H3: 'issue' before 'create' so explicit "ban hành" / "phát hành" / "ra quyết định"
  // patterns match before the broader "viết / soạn / tạo" patterns.
  const intentOrder: Array<keyof typeof INTENT_PATTERNS> = ['revoke', 'modify', 'issue', 'create', 'report', 'notify'];
  for (const intent of intentOrder) {
    if (INTENT_PATTERNS[intent].some(p => p.test(prompt))) {
      result.intent = intent as ParsedCommand['intent'];
      break;
    }
  }

  // Document type detection
  const normalizedPrompt = normalizeVietnamese(prompt);
  for (const matcher of DOCTYPE_MATCHERS) {
    if (normalizedPrompt.includes(matcher.alias)) {
      result.docType = matcher.id;
      break;
    }
  }

  // Entity extraction
  const agency = prompt.match(ENTITY_PATTERNS.agency);
  if (agency) result.entities.agency = agency[1] || agency[0];

  const subject = prompt.match(ENTITY_PATTERNS.subject);
  if (subject) result.entities.subject = subject[1].trim();

  const person = prompt.match(ENTITY_PATTERNS.targetPerson);
  if (person) result.entities.targetPerson = person[0].trim();

  const date = prompt.match(ENTITY_PATTERNS.dateVn);
  if (date) result.entities.dateVn = `${date[1]}/${date[2]}/${date[3]}`;

  const place = prompt.match(ENTITY_PATTERNS.place);
  if (place) result.entities.place = place[1].trim();

  // Legal basis references
  const legalMatches = prompt.matchAll(ENTITY_PATTERNS.legalBasis);
  for (const m of legalMatches) {
    (result.entities.legalBasis ??= []).push(m[0].trim());
  }

  return result;
}
