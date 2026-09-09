import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { TerminologyService, expandWithAliases } from "../terminology/terminology.service.js";

const CURRENT_FISCAL_YEAR = 2026;
const MIN_SIGNIFICANT_WORD_LENGTH = 4;
const MIN_DISTINCTIVE_WORD_LENGTH = 6;
const MAX_SUGGESTIONS = 30;
const MAX_EVIDENCE_ITEMS = 200;
const MAX_PREFIX_EXPANSION = 20;

export type CodeSuggestion = {
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  code: string;
  description: string;
  isBillable: boolean;
  /** The literal sentence from the documentation that justifies this
   *  suggestion — never invent evidence, never suggest without it. */
  evidenceExcerpt: string;
  documentId: number;
  documentType: string;
  /** The alphabetic-index term that matched — same transparency principle
   *  as the encoder's matchedVia. */
  matchedVia: string;
};

/** One matched (sentence, index term) pair supporting a code — the same
 *  shape as CodeSuggestion, but listAllEvidence() does not stop at the
 *  first match per code, so a single code can appear many times: once per
 *  sentence/term that independently supports it, possibly across several
 *  documents. This is the raw material for "why this code" explanations
 *  that want the full evidentiary trail, not just the first hit. */
export type EvidenceItem = CodeSuggestion;

/**
 * A deliberately EXPLAINABLE, dictionary-based extraction — not an LLM call.
 * For every sentence in every document, every Alphabetic Index term (the
 * same CMS/NCHS index used for the encoder's synonym search) is checked:
 * if every "significant" word (4+ chars, filters out connectors like "with"/
 * "due"/"the") of the index term appears somewhere in that sentence, the
 * code the term points to is suggested, with the sentence itself as the
 * evidence. This is a real, if simple, form of dictionary-based clinical
 * NLP — the same category of technique early commercial CAC tools used —
 * chosen deliberately over an opaque model call so every suggestion is
 * traceable to the exact text that produced it. It will miss synonyms not
 * in the index and phrasings that split a condition across sentences; it
 * will not silently invent a diagnosis that isn't supported anywhere in
 * the text.
 */
@Injectable()
export class SuggestionsService {
  constructor(
    private readonly prisma: AppPrismaService,
    private readonly referencePrisma: ReferencePrismaService,
    private readonly terminologyService: TerminologyService
  ) {}

  /**
   * One suggestion per code — the first sentence/term that matched it,
   * scanning documents in order. Built on top of listAllEvidence() so the
   * two views can never disagree about what counts as a match. Includes
   * codes a coder has already rejected — this is the raw match set, not a
   * coder's decision about it. Use listActiveSuggestions() for anything
   * shown to a coder as something still worth reviewing.
   */
  async listSuggestions(encounterId: number, facilityId: number): Promise<CodeSuggestion[]> {
    const allEvidence = await this.listAllEvidence(encounterId, facilityId);
    const seen = new Set<string>();
    const suggestions: CodeSuggestion[] = [];
    for (const item of allEvidence) {
      const key = `${item.codeSystem}:${item.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(item);
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  }

  /**
   * listSuggestions(), minus anything a coder has already rejected for this
   * encounter — the single filter every "what's still worth reviewing" view
   * (the Suggestions panel, Chart Intelligence's potential findings) should
   * go through, so a rejected suggestion can't resurface in one place while
   * staying hidden in another.
   */
  async listActiveSuggestions(encounterId: number, facilityId: number): Promise<CodeSuggestion[]> {
    const [suggestions, rejections] = await Promise.all([
      this.listSuggestions(encounterId, facilityId),
      this.prisma.rejectedSuggestion.findMany({ where: { encounterId } }),
    ]);
    const rejectedKeys = new Set(rejections.map((r) => `${r.codeSystem}:${r.code}`));
    return suggestions.filter((s) => !rejectedKeys.has(`${s.codeSystem}:${s.code}`));
  }

  async rejectSuggestion(
    encounterId: number,
    facilityId: number,
    userId: number,
    code: string,
    codeSystem: "ICD-10-CM" | "ICD-10-PCS"
  ): Promise<void> {
    const encounter = await this.prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }

    await this.prisma.rejectedSuggestion.upsert({
      where: { encounterId_code_codeSystem: { encounterId, code, codeSystem } },
      create: { encounterId, code, codeSystem, rejectedById: userId },
      update: {},
    });
  }

  /**
   * Every independent (sentence, index term) match, for every code, without
   * deduplication — the same code can appear many times if several
   * sentences (in the same or different documents) each support it via a
   * different phrasing. Callers that want the full evidentiary trail for a
   * specific code (e.g. the decision-explanation card) filter this list
   * down rather than re-scanning the chart themselves.
   */
  async listAllEvidence(encounterId: number, facilityId: number): Promise<EvidenceItem[]> {
    const encounter = await this.prisma.encounter.findUnique({
      where: { id: encounterId },
      include: { documents: true },
    });
    if (!encounter) throw new NotFoundException(`encounter ${encounterId} not found`);
    if (encounter.facilityId !== facilityId) {
      throw new ForbiddenException("encounter belongs to a different facility");
    }

    const sentences = encounter.documents.flatMap((doc) =>
      splitIntoSentences(doc.content).map((sentence) => ({
        sentence,
        documentId: doc.id,
        documentType: doc.type,
      }))
    );
    if (sentences.length === 0) return [];

    const [cmEntries, pcsEntries, aliases] = await Promise.all([
      this.referencePrisma.synonymIndexEntry.findMany({
        where: { codeSystem: "ICD-10-CM", fiscalYear: CURRENT_FISCAL_YEAR },
      }),
      this.referencePrisma.synonymIndexEntry.findMany({
        where: { codeSystem: "ICD-10-PCS", fiscalYear: CURRENT_FISCAL_YEAR },
      }),
      this.terminologyService.loadAliases(),
    ]);

    // Precompute each entry's required word-groups once, rather than
    // re-parsing the same term string for every sentence — the expensive
    // part is the split/regex work, not the substring checks. Entries that
    // are just one short-ish word (e.g. "right", "left", "with") are
    // dropped entirely — otherwise a generic laterality word matches almost
    // any sentence (this caught a real false positive during testing:
    // "right" alone matched "Ear, wax, right" against an unrelated
    // sentence).
    const cmEntryWords = cmEntries
      .map((entry) => ({ entry, groups: significantWordGroups(entry.term) }))
      .filter((e) => isDistinctiveEnough(e.groups, hasHiddenShortWord(e.entry.term, e.groups)));
    const pcsEntryWords = pcsEntries
      .map((entry) => ({ entry, groups: significantWordGroups(entry.term) }))
      .filter((e) => isDistinctiveEnough(e.groups, hasHiddenShortWord(e.entry.term, e.groups)));

    // A code can match many sentences now (no early "already seen, skip"
    // exit), so its reference-table row is cached the first time it's
    // looked up rather than re-queried on every subsequent match.
    const cmCodeCache = new Map<string, { code: string; longDescription: string; isBillable: boolean } | null>();
    const pcsCodeCache = new Map<string, { code: string; description: string; isBillable: boolean } | null>();
    // matchType 'prefix' entries (11% of the whole CM index — see
    // docs/TEST_REPORT.md "Synonym clusters") give a code STEM requiring
    // more characters (e.g. "S4081" needs a 7th-character encounter-type
    // extension), not a single valid code. Resolved by expanding to the
    // real billable codes under that stem, same pattern already proven in
    // EncoderService.searchIcd10Cm() for the identical problem — this
    // service just never had it applied. Cached per stem since many
    // sentences can hit the same prefix entry.
    const cmPrefixCache = new Map<string, { code: string; longDescription: string; isBillable: boolean }[]>();

    const evidence: EvidenceItem[] = [];

    for (const { sentence, documentId, documentType } of sentences) {
      if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
      // Matching runs against the abbreviation-expanded sentence (so "COPD"
      // in a note matches the index's "chronic obstructive pulmonary
      // disease") — but evidenceExcerpt below always uses the original
      // `sentence`, never this expanded version, so a coder sees the chart
      // verbatim, not a paraphrase.
      const expandedSentence = expandWithAliases(sentence, aliases).toLowerCase();
      // Whole-word matching, not substring: without this, a short term like
      // "PRES" (an acronym) would false-positive-match inside "impression".
      const sentenceWords = new Set(tokenizeWords(expandedSentence));

      for (const { entry, groups } of cmEntryWords) {
        if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
        if (groups.length === 0 || !groupsSatisfied(groups, sentenceWords)) continue;

        if (entry.matchType === "prefix") {
          if (!cmPrefixCache.has(entry.codeValue)) {
            const expansions = await this.referencePrisma.icd10CmCode.findMany({
              where: { fiscalYear: CURRENT_FISCAL_YEAR, isBillable: true, code: { startsWith: entry.codeValue } },
              take: MAX_PREFIX_EXPANSION,
            });
            cmPrefixCache.set(entry.codeValue, expansions);
          }
          for (const code of cmPrefixCache.get(entry.codeValue)!) {
            if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
            evidence.push({
              codeSystem: "ICD-10-CM",
              code: code.code,
              description: code.longDescription,
              isBillable: code.isBillable,
              evidenceExcerpt: sentence,
              documentId,
              documentType,
              matchedVia: entry.term,
            });
          }
          continue;
        }

        if (!cmCodeCache.has(entry.codeValue)) {
          const found = await this.referencePrisma.icd10CmCode.findUnique({
            where: { code_fiscalYear: { code: entry.codeValue, fiscalYear: CURRENT_FISCAL_YEAR } },
          });
          cmCodeCache.set(entry.codeValue, found && found.isBillable ? found : null);
        }
        const code = cmCodeCache.get(entry.codeValue);
        if (!code) continue;

        evidence.push({
          codeSystem: "ICD-10-CM",
          code: code.code,
          description: code.longDescription,
          isBillable: code.isBillable,
          evidenceExcerpt: sentence,
          documentId,
          documentType,
          matchedVia: entry.term,
        });
      }

      for (const { entry, groups } of pcsEntryWords) {
        if (evidence.length >= MAX_EVIDENCE_ITEMS) break;
        if (groups.length === 0 || !groupsSatisfied(groups, sentenceWords)) continue;

        if (entry.matchType === "code") {
          if (!pcsCodeCache.has(entry.codeValue)) {
            const found = await this.referencePrisma.icd10PcsCode.findUnique({
              where: { code_fiscalYear: { code: entry.codeValue, fiscalYear: CURRENT_FISCAL_YEAR } },
            });
            pcsCodeCache.set(entry.codeValue, found && found.isBillable ? found : null);
          }
          const code = pcsCodeCache.get(entry.codeValue);
          if (!code) continue;

          evidence.push({
            codeSystem: "ICD-10-PCS",
            code: code.code,
            description: code.description,
            isBillable: code.isBillable,
            evidenceExcerpt: sentence,
            documentId,
            documentType,
            matchedVia: entry.term,
          });
        }
        // 'prefix' entries (PCS table stubs) are deliberately not expanded
        // here — a table stub alone isn't specific enough to suggest as a
        // single code without a coder choosing the approach/device, unlike
        // the encoder's interactive search where that choice happens live.
      }
    }

    return evidence;
  }
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenizeWords(text: string): string[] {
  return text.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
}

/**
 * Words that are long enough to pass the length check but too generic to
 * ever mean something on their own — "disease", "syndrome", etc. appear as
 * the sole significant word in many unrelated index entries (e.g. "Erb's,
 * disease").
 *
 * Originally this set was only consulted by isDistinctiveEnough(), to
 * decide whether an entry qualified for matching at all — it was NOT
 * removed from the word list actually required by the `.every()` match
 * check, so an entry with other real content words alongside a generic one
 * still demanded the generic word too. That silently broke real matches:
 * the ICD-10-CM Alphabetic Index entry for J44.1 is the tree path "Disease,
 * diseased, pulmonary, chronic obstructive, with, exacerbation" — a
 * documentation sentence saying "acute COPD exacerbation" (expanded to
 * "...chronic obstructive pulmonary disease exacerbation") contains
 * "disease" but never the alternate spelling "diseased", so the match
 * always failed despite every real content word being present. Confirmed
 * by pulling the actual index rows for J440/J441/J449 rather than
 * guessing — this false negative, not a missing "clinical understanding"
 * layer, was the real cause of the COPD-exacerbation gap noted in
 * docs/TEST_REPORT.md. Now stripped inside significantWords() itself, so
 * both the distinctiveness check and the actual match use the same
 * (correct) required-word list.
 */
// "specified" added after a data-driven sweep of the whole FY2026 index
// (see scripts/analyze-index-word-frequency.ts and
// scripts/analyze-structural-words.ts, run once and not kept as a
// permanent script — see docs/VALIDATION_METHODOLOGY.md's "verify before
// architecting" note): 118 entries carry "specified" as its own isolated
// tree-node segment rather than combined with other words (e.g.
// "Complication, transplant, specified, tissue, infection" -> T86.892,
// "Other transplanted tissue infection") — the same shape of bug "with"
// was. A real note about a transplanted-tissue infection would name the
// tissue, not use the literal word "specified". Words considered and
// deliberately NOT added despite high raw frequency: "type" (a real,
// clinically distinguishing word — "type I" vs "type II" point to
// different codes), "site"/"body" (real anatomical content, e.g. mandible
// "body" vs ramus), "without" (only 8 isolated occurrences across the
// whole index, all inside real phrases like "without adequate housing" —
// not a structural marker the way "with" is).
const GENERIC_MEDICAL_WORDS = new Set([
  "disease",
  "diseased",
  "syndrome",
  "disorder",
  "condition",
  "conditions",
  "specified",
]);

/**
 * "with" is not real clinical content — it's the ICD-10-CM Alphabetic
 * Index's own standard convention for a subheading that introduces
 * associated/combination conditions (e.g. the tree node titled "with"
 * under "chronic obstructive pulmonary disease", leading to "exacerbation"
 * as its child). The code's own significantWords() comment already
 * intended to filter connectors like "with" — but "with" is exactly 4
 * characters, the same as MIN_SIGNIFICANT_WORD_LENGTH, so it slipped past
 * the length filter and was silently required verbatim in the source text
 * on every such entry. Combined with the GENERIC_MEDICAL_WORDS fix above,
 * this accounts for the bulk of "obviously-coded condition doesn't
 * surface" cases. "from" is the same shape of bug at much smaller scale
 * (3 isolated occurrences index-wide, e.g. "Hemorrhage, hemorrhagic,
 * from, tracheostomy stoma") — included for the same reason, at
 * essentially zero risk of introducing a false positive.
 */
const CONNECTOR_WORDS = new Set(["with", "from"]);

/**
 * Explicit, data-verified clusters of word-FORM variants — noun/adjective/
 * verb spellings of the same underlying concept — that the CMS Alphabetic
 * Index writes as consecutive required words in a single headword (e.g.
 * "Hypertension, hypertensive" as literally the first two words of the I10
 * family). Before this fix, significantWords() required every one of these
 * spellings verbatim — but real documentation only ever uses ONE spelling,
 * so an entry needing both "hypertension" and "hypertensive" in the same
 * sentence almost never matched anything. Found via a systematic sweep of
 * 20 common inpatient conditions against the real index (see
 * docs/TEST_REPORT.md "Synonym clusters"), not guessed: 5 of 9 failures in
 * that sweep traced to this exact pattern.
 *
 * Each inner array is one cluster — matching now requires only ONE member
 * present in the sentence, not all of them. Deliberately a curated,
 * verified list, not a generic stemmer: a generic stemmer risks
 * false-merging genuinely different concepts that happen to share a
 * prefix (e.g. "hepatic" and "hepatitis" are NOT interchangeable, even
 * though a naive stemmer would group them) — the same reasoning that kept
 * GENERIC_MEDICAL_WORDS and CONNECTOR_WORDS above as explicit lists rather
 * than an algorithm.
 *
 * A fifth cluster — ulcer/ulcerated/ulcerating/ulceration/ulcerative — was
 * found in the same sweep (it explains the "Pressure ulcer" failure) but is
 * deliberately NOT included here. Checking it against the real index first
 * (same discipline as everything else in this list) found it introduces
 * real new false positives: several pressure-ulcer entries pair the
 * cluster with a genuinely distinguishing but SHORT word that
 * MIN_SIGNIFICANT_WORD_LENGTH silently drops — "Ulcer, ..., gum" -> K06.8
 * and "Ulcer, ..., lip" -> K13.0 collapse to "does the sentence contain
 * 'ulcer'?" once the cluster relaxation is applied, which is far too broad.
 * Fixing that needs a real fix for short-but-meaningful words being
 * dropped by length, which is a separate, not-yet-done piece of work — see
 * docs/TEST_REPORT.md "Synonym clusters".
 */
const SYNONYM_CLUSTERS: string[][] = [
  ["hypertension", "hypertensive"],
  ["diabetes", "diabetic"],
  ["thrombosis", "thrombotic"],
  ["failure", "failed"],
  // Found by the P1-E0 evaluation harness (docs/EVALUATION_HARNESS.md,
  // Fix #1), not guessed: "acute respiratory failure" — one of the most
  // common, highest CC/MCC-impact inpatient diagnoses — matched nothing,
  // because the real index entry ("Failure, failed, respiration,
  // respiratory, acute" -> J96.00) requires "respiration" AND "respiratory"
  // as two separate words, and real documentation only ever writes
  // "respiratory failure," never "respiration respiratory failure." Same
  // pattern as the four clusters above: real documentation uses one
  // spelling, the index headword happens to write both.
  ["respiration", "respiratory"],
  // Fix #3 (docs/EVALUATION_HARNESS.md) — the already-documented "MI
  // infarct/infarction cluster" Known Limitation, verified against the
  // real index before shipping rather than guessed: the real headword is
  // literally "Infarct, infarction, myocardium, myocardial" (all four
  // words, confirmed identical across the entire I21.x subtree). Real
  // documentation never writes all four, or even two from the same
  // concept, at once.
  //
  // Deliberately shipped as TWO separate clusters, not one four-way
  // cluster — same reasoning that already excluded the five-way ulcer
  // cluster (see the SYNONYM_CLUSTERS doc comment above): "infarct"/
  // "infarction" are word-forms of the EVENT, "myocardium"/"myocardial"
  // are word-forms of the SITE, and they are two different concepts that
  // happen to co-occur in this one compound headword, not interchangeable
  // spellings of the same thing. A single four-way cluster would let bare
  // anatomical language ("the myocardium appeared healthy on biopsy," no
  // infarction ever mentioned) alone satisfy the whole requirement, once
  // isDistinctiveEnough's length-6 fallback kicks in for a single
  // remaining group — a real false-positive risk, checked and confirmed
  // against exactly this sentence before choosing this structure. Two
  // groups (AND between them, OR within each) requires real documentation
  // to name both the event and the site, which "myocardial infarction" —
  // or "MI" after abbreviation expansion — always does, while bare
  // anatomical mentions of the myocardium alone correctly still don't
  // match.
  ["infarct", "infarction"],
  ["myocardium", "myocardial"],
];

/**
 * Pure noise — CMS index abbreviations and English connectors/articles
 * that never carry clinical meaning on their own, regardless of context.
 * Distinct from real short anatomical/clinical words (arm, leg, hip, lip,
 * gum, ear, HIV...) which MIN_SIGNIFICANT_WORD_LENGTH also drops but which
 * DO carry real meaning — see hasHiddenShortWord() below, which is what
 * actually protects against those.
 */
const KNOWN_STOPWORDS = new Set([
  "nec", "nos", "or", "to", "due", "of", "in", "by", "and", "not", "as", "on",
  "for", "non", "pre", "at", "the", "out", "use", "a", "i", "s",
]);

/**
 * True when the term's ORIGINAL text (before any filtering) contained a
 * real, non-stopword word shorter than MIN_SIGNIFICANT_WORD_LENGTH that
 * isn't already captured in `groups` — i.e. specificity was silently lost.
 * Found via a systematic short-word investigation (see docs/TEST_REPORT.md
 * "Short-word specificity loss"): "Injury, arm" reduces to the single
 * word "injury" once "arm" (3 characters) is dropped, and requiring only
 * "injury" is far too broad — it matched an "acute kidney injury" sentence
 * that has nothing to do with an arm. Whether this actually causes a
 * problem depends entirely on whether OTHER real content survived
 * alongside the dropped word: an entry with 2+ groups already requires
 * enough else that losing one short qualifier is low-risk (unaffected by
 * this check); this only tightens the risky case where a single long word
 * would otherwise stand in — via isDistinctiveEnough's fallback branch —
 * for what used to be a two-part requirement.
 */
function hasHiddenShortWord(term: string, groups: string[][]): boolean {
  const kept = new Set(groups.flat());
  return tokenizeWords(term.toLowerCase()).some(
    (w) => w.length > 0 && w.length < MIN_SIGNIFICANT_WORD_LENGTH && !KNOWN_STOPWORDS.has(w) && !kept.has(w)
  );
}

function isDistinctiveEnough(groups: string[][], hiddenShortWord: boolean): boolean {
  if (groups.length >= 2) return true;
  if (hiddenShortWord) return false;
  return groups.some((group) => group.some((w) => w.length >= MIN_DISTINCTIVE_WORD_LENGTH));
}

/** True when every group has at least one member present in the sentence —
 *  a group of size 1 behaves exactly like the old "every word required"
 *  check; a synonym-cluster group of size >1 is satisfied by any one
 *  spelling. */
function groupsSatisfied(groups: string[][], sentenceWords: Set<string>): boolean {
  return groups.every((group) => group.some((w) => sentenceWords.has(w)));
}

/** A token made entirely of digits — "1", "3", "5"... never a stopword or
 *  generic-medical word, and unlike a short English word (see
 *  hasHiddenShortWord below), never ambiguous: a "3" in "stage 3" always
 *  means stage 3, not something else that happens to be short. */
function isNumericQualifier(w: string): boolean {
  return /^\d+$/.test(w);
}

/**
 * The significant words of a term, grouped so that members of the same
 * SYNONYM_CLUSTERS entry sit together (an OR-requirement) while everything
 * else stays its own single-word group (an AND-requirement, same as
 * before). Order doesn't matter for matching, only group membership.
 *
 * Found by the P1-E0 evaluation harness (docs/EVALUATION_HARNESS.md,
 * Fix #2), not guessed: MIN_SIGNIFICANT_WORD_LENGTH=4 silently dropped
 * standalone digits as "too short," so every numerically-staged condition
 * (CKD stage 1-5, retinopathy-of-prematurity stage 0-5, diabetes Type 1 vs
 * Type 2, pressure-ulcer stages, necrotizing-enterocolitis stages...)
 * collapsed to "any stage/type matches," confirmed at scale: 940 of 63,138
 * FY2026 index entries carry a standalone digit. Digits are exempted from
 * the length filter here — unlike a short English word (which might
 * legitimately be dropped as ambiguous, see hasHiddenShortWord), a digit
 * is never ambiguous: "3" always means exactly stage/type 3.
 */
function significantWordGroups(term: string): string[][] {
  const words = tokenizeWords(term.toLowerCase())
    .filter((w) => w.length >= MIN_SIGNIFICANT_WORD_LENGTH || isNumericQualifier(w))
    .filter((w) => !GENERIC_MEDICAL_WORDS.has(w) && !CONNECTOR_WORDS.has(w));

  const groups: string[][] = [];
  const consumed = new Set<string>();
  for (const w of words) {
    if (consumed.has(w)) continue;
    const cluster = SYNONYM_CLUSTERS.find((c) => c.includes(w));
    if (cluster) {
      const present = words.filter((x) => cluster.includes(x));
      present.forEach((p) => consumed.add(p));
      groups.push(present);
    } else {
      consumed.add(w);
      groups.push([w]);
    }
  }
  return groups;
}
