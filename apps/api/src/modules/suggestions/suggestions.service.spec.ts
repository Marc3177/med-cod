import { afterAll, afterEach, describe, expect, it } from "vitest";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { AppPrismaService } from "../../prisma/app-prisma.service.js";
import { ReferencePrismaService } from "../../prisma/reference-prisma.service.js";
import { TerminologyService } from "../terminology/terminology.service.js";
import { SuggestionsService } from "./suggestions.service.js";
import { createTestEncounter, deleteTestEncounter, TEST_FACILITY_ID } from "../../test-support/encounter-fixture.js";

/**
 * Regression coverage for real bugs found and fixed during manual testing
 * (see docs/TEST_REPORT.md "Encoder didn't expand common clinical
 * abbreviations", "Clinical understanding — scoped, and mostly already
 * fixed", "Broadening the word-filter fix"). Every case here reproduces a
 * sentence that either used to silently fail to match, or used to
 * false-positive-match, against the real FY2026 index — not synthetic
 * fixtures, so a future change to the matching logic gets caught here
 * before it needs a manual curl session to rediscover.
 */
describe("SuggestionsService", () => {
  const appPrisma = new AppPrismaService();
  const referencePrisma = new ReferencePrismaService();
  const terminology = new TerminologyService(referencePrisma);
  const service = new SuggestionsService(appPrisma, referencePrisma, terminology);

  const encounterIds: number[] = [];

  async function seed(documents: { type: string; content: string }[]): Promise<number> {
    const id = await createTestEncounter(appPrisma, documents);
    encounterIds.push(id);
    return id;
  }

  afterEach(async () => {
    while (encounterIds.length > 0) {
      const id = encounterIds.pop()!;
      await deleteTestEncounter(appPrisma, id);
    }
  });

  afterAll(async () => {
    await appPrisma.$disconnect();
    await referencePrisma.$disconnect();
  });

  it("matches COPD-with-exacerbation despite the abbreviation, via the corrected word filter (regression: TEST_REPORT 'Clinical understanding')", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with acute COPD exacerbation." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    expect(suggestions.map((s) => s.code)).toContain("J441");
  });

  it("matches a 'specified' isolated index node without requiring the literal word 'specified' (regression: TEST_REPORT 'Broadening the word-filter fix')", async () => {
    const encounterId = await seed([
      {
        type: "DISCHARGE_SUMMARY",
        content: "Patient developed a transplant complication with tissue infection during the post-operative course.",
      },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    expect(suggestions.map((s) => s.code)).toContain("T86892");
  });

  it.each([
    {
      label: "hypertensive urgency",
      content: "Blood pressure elevated, consistent with hypertensive urgency.",
      expectCode: "I160",
    },
    {
      label: "type 2 diabetes",
      content: "History of type 2 diabetes mellitus, well controlled.",
      expectCode: "E119",
    },
    {
      label: "DVT",
      content: "Ultrasound confirmed deep vein thrombosis of the left leg.",
      expectCode: "I8290",
    },
    {
      label: "CHF exacerbation",
      content: "Patient presents with acute CHF exacerbation.",
      expectCode: "I509",
    },
  ])(
    "matches $label via a synonym-cluster word-form (regression: TEST_REPORT 'Synonym clusters')",
    async ({ content, expectCode }) => {
      const encounterId = await seed([{ type: "DISCHARGE_SUMMARY", content }]);

      const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

      expect(suggestions.map((s) => s.code)).toContain(expectCode);
    }
  );

  it("resolves matchType 'prefix' CM index entries to real billable codes instead of silently dropping them (regression: TEST_REPORT 'Short-word specificity loss')", async () => {
    const encounterId = await seed([{ type: "DISCHARGE_SUMMARY", content: "Abrasion noted on the right ankle." }]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    // "Abrasion, ankle" -> S90.51 is matchType "prefix" (a code stem
    // needing a 7th-character encounter-type extension) with no separate
    // matchType "code" entry pointing at the same code — the ONLY route to
    // a real billable code here is the prefix-expansion fix. S9051 itself
    // is a non-billable header; the real leaf codes all start with it.
    expect(suggestions.some((s) => s.code.startsWith("S9051"))).toBe(true);
  });

  it("does not let a dropped short word (e.g. 'arm') collapse an entry to a single overly-generic word, flooding results with unrelated codes (regression: TEST_REPORT 'Short-word specificity loss')", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Creatinine rising, consistent with acute kidney injury." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    // "Injury, arm" collapses to requiring only "injury" once "arm" (3
    // characters) is silently dropped — before the hidden-short-word fix,
    // this alone matched a kidney-injury sentence and, combined with the
    // matchType "prefix" fix, expanded into ~20 unrelated arm-injury codes
    // that filled the MAX_SUGGESTIONS cap and pushed N179 out entirely.
    expect(suggestions.some((s) => s.code.startsWith("S49"))).toBe(false);
    expect(suggestions.length).toBeLessThan(25);
  });

  it("does not let a dropped short anatomical word (e.g. 'lip') cause an unrelated match (regression: TEST_REPORT 'Short-word specificity loss')", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Right lower extremity cellulitis noted on exam." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    // K13.0 is "Cellulitis, lip" — the entry collapses to just "cellulitis"
    // once "lip" is dropped, which would otherwise match any cellulitis
    // mention regardless of site.
    expect(suggestions.map((s) => s.code)).not.toContain("K130");
  });

  it("does NOT relax the ulcer/ulcerated/ulcerating/ulceration/ulcerative cluster — deliberately excluded because it collapses short-anatomical-word entries to false positives (regression: TEST_REPORT 'Synonym clusters')", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Stage 2 pressure ulcer noted on the sacrum." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    // Must NOT include K06.8 ("Ulcer, ..., gum") or K13.0 ("Ulcer, ...,
    // lip") — neither gum nor lip nor sacrum is mentioned; a relaxed ulcer
    // cluster would collapse both entries to "does the sentence say
    // ulcer?" and match them anyway.
    expect(suggestions.map((s) => s.code)).not.toContain("K068");
    expect(suggestions.map((s) => s.code)).not.toContain("K130");
  });

  it("still correctly matches a previously-passing case (aspiration pneumonia)", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Noted to have aspiration pneumonia on imaging." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    expect(suggestions.map((s) => s.code)).toEqual(expect.arrayContaining(["J690", "J189"]));
  });

  it("does not false-positive-match a sentence containing only generic/connector words (regression: TEST_REPORT 'Erb's, disease' and the word-filter broadening)", async () => {
    const encounterId = await seed([
      {
        type: "DISCHARGE_SUMMARY",
        content: "The specified condition was noted, along with a disorder from an unspecified source.",
      },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);

    expect(suggestions).toEqual([]);
  });

  it("listSuggestions dedups to one entry per code even when multiple sentences/documents support it", async () => {
    const encounterId = await seed([
      {
        type: "HISTORY_AND_PHYSICAL",
        content: "Patient presents with pneumonia. Chest X-ray consistent with pneumonia.",
      },
      { type: "DISCHARGE_SUMMARY", content: "Discharge diagnosis: pneumonia, unspecified organism." },
    ]);

    const suggestions = await service.listSuggestions(encounterId, TEST_FACILITY_ID);
    const j189Matches = suggestions.filter((s) => s.code === "J189");

    expect(j189Matches).toHaveLength(1);
  });

  it("listAllEvidence surfaces every independent match, not just the first (evidence graph)", async () => {
    const encounterId = await seed([
      {
        type: "HISTORY_AND_PHYSICAL",
        content: "Patient presents with pneumonia. Chest X-ray consistent with pneumonia.",
      },
      { type: "DISCHARGE_SUMMARY", content: "Discharge diagnosis: pneumonia, unspecified organism." },
    ]);

    const evidence = await service.listAllEvidence(encounterId, TEST_FACILITY_ID);
    const j189Evidence = evidence.filter((e) => e.code === "J189");

    expect(j189Evidence).toHaveLength(3);
    expect(new Set(j189Evidence.map((e) => e.documentId)).size).toBe(2);
  });

  it("listActiveSuggestions excludes a rejected suggestion, and the rejection is scoped to the encounter", async () => {
    const encounterId = await seed([
      { type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." },
    ]);

    const before = await service.listActiveSuggestions(encounterId, TEST_FACILITY_ID);
    expect(before.map((s) => s.code)).toContain("J189");

    await service.rejectSuggestion(encounterId, TEST_FACILITY_ID, 1, "J189", "ICD-10-CM");

    const after = await service.listActiveSuggestions(encounterId, TEST_FACILITY_ID);
    expect(after.map((s) => s.code)).not.toContain("J189");

    // listSuggestions (the raw match set) must still include it — rejection
    // is a coder decision layered on top, not a change to what matched.
    const raw = await service.listSuggestions(encounterId, TEST_FACILITY_ID);
    expect(raw.map((s) => s.code)).toContain("J189");
  });

  it("throws NotFoundException for an encounter that does not exist", async () => {
    await expect(service.listSuggestions(999999999, TEST_FACILITY_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws ForbiddenException when the encounter belongs to a different facility", async () => {
    const encounterId = await seed([{ type: "DISCHARGE_SUMMARY", content: "Patient admitted with pneumonia." }]);

    await expect(service.listSuggestions(encounterId, TEST_FACILITY_ID + 999)).rejects.toBeInstanceOf(
      ForbiddenException
    );
  });
});
