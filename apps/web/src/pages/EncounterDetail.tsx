import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { patientsApi } from "../api/patients.js";
import { encoderApi } from "../api/encoder.js";
import { codingApi } from "../api/coding.js";
import { grouperApi, type DrgPreview } from "../api/grouper.js";
import { suggestionsApi, type CodeSuggestion } from "../api/suggestions.js";
import { queriesApi, type CodingQuery } from "../api/queries.js";
import { qaApi, type QaReview } from "../api/qa.js";
import { documentationGapsApi, type DocumentationGap } from "../api/documentationGaps.js";
import { chartIntelligenceApi, type ChartSummary } from "../api/chartIntelligence.js";
import { chartChangesApi, type ChartChangeSummary } from "../api/chartChanges.js";
import { decisionExplanationApi, type DecisionExplanation } from "../api/decisionExplanation.js";
import type {
  CodedDiagnosis,
  CodedProcedure,
  EncounterDetail as EncounterDetailType,
  Icd10CmResult,
  Icd10PcsResult,
} from "../api/types.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { DrgPanel } from "../components/DrgPanel.js";
import { SuggestionsPanel } from "../components/SuggestionsPanel.js";
import { QueriesPanel } from "../components/QueriesPanel.js";
import { DocumentationGapsPanel } from "../components/DocumentationGapsPanel.js";
import { ChartIntelligencePanel } from "../components/ChartIntelligencePanel.js";
import { ChartChangesBanner } from "../components/ChartChangesBanner.js";
import { DecisionExplanationCard } from "../components/DecisionExplanationCard.js";
import { ChartReviewSummary } from "../components/ChartReviewSummary.js";

const CODE_VERSION = "2026";

export function EncounterDetail() {
  const { id } = useParams<{ id: string }>();
  const encounterId = Number(id);

  const [encounter, setEncounter] = useState<EncounterDetailType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);

  const [diagnoses, setDiagnoses] = useState<CodedDiagnosis[]>([]);
  const [procedures, setProcedures] = useState<CodedProcedure[]>([]);

  const [dxQuery, setDxQuery] = useState("");
  const [dxResults, setDxResults] = useState<Icd10CmResult[]>([]);
  const [pxQuery, setPxQuery] = useState("");
  const [pxResults, setPxResults] = useState<Icd10PcsResult[]>([]);

  const [drgPreview, setDrgPreview] = useState<DrgPreview>(null);
  const [suggestions, setSuggestions] = useState<CodeSuggestion[]>([]);
  const [queries, setQueries] = useState<CodingQuery[]>([]);
  const [qaReviews, setQaReviews] = useState<QaReview[]>([]);
  const [documentationGaps, setDocumentationGaps] = useState<DocumentationGap[]>([]);
  const [chartSummary, setChartSummary] = useState<ChartSummary | null>(null);
  const [chartChanges, setChartChanges] = useState<ChartChangeSummary | null>(null);
  const [explanationOpen, setExplanationOpen] = useState(false);
  const [explanation, setExplanation] = useState<DecisionExplanation | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [highlightedDocId, setHighlightedDocId] = useState<number | null>(null);
  const [dismissedGapKeys, setDismissedGapKeys] = useState<Set<string>>(new Set());

  function load() {
    patientsApi
      .encounter(encounterId)
      .then((e) => {
        setEncounter(e);
        setDiagnoses(e.codingDecision?.diagnoses ?? []);
        setProcedures(e.codingDecision?.procedures ?? []);
      })
      .catch((e) => setError(String(e)));
  }

  useEffect(load, [encounterId]);

  function loadSuggestions() {
    suggestionsApi
      .list(encounterId)
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }

  useEffect(loadSuggestions, [encounterId]);

  function loadQueries() {
    queriesApi
      .listForEncounter(encounterId)
      .then(setQueries)
      .catch(() => setQueries([]));
  }

  useEffect(loadQueries, [encounterId]);

  function loadQaReviews() {
    qaApi
      .listForEncounter(encounterId)
      .then(setQaReviews)
      .catch(() => setQaReviews([]));
  }

  useEffect(loadQaReviews, [encounterId]);

  useEffect(() => {
    documentationGapsApi
      .list(encounterId)
      .then(setDocumentationGaps)
      .catch(() => setDocumentationGaps([]));
  }, [encounterId]);

  function loadChartSummary() {
    chartIntelligenceApi
      .getSummary(encounterId)
      .then(setChartSummary)
      .catch(() => setChartSummary(null));
  }

  useEffect(loadChartSummary, [encounterId]);

  useEffect(() => {
    chartChangesApi
      .getChanges(encounterId)
      .then(setChartChanges)
      .catch(() => setChartChanges(null))
      .finally(() => chartChangesApi.acknowledge(encounterId).catch(() => {}));
  }, [encounterId]);

  function openExplanation(code: string, codeSystem: "ICD-10-CM" | "ICD-10-PCS") {
    setExplanationOpen(true);
    setExplanationLoading(true);
    setExplanation(null);
    decisionExplanationApi
      .explain(encounterId, code, codeSystem)
      .then(setExplanation)
      .catch(() => setExplanation(null))
      .finally(() => setExplanationLoading(false));
  }

  function closeExplanation() {
    setExplanationOpen(false);
  }

  function jumpToEvidence(documentId: number) {
    const el = document.getElementById(`doc-${documentId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedDocId(documentId);
    setTimeout(() => setHighlightedDocId((current) => (current === documentId ? null : current)), 2000);
  }

  function gapKey(gap: DocumentationGap): string {
    return `${gap.indicatorName}-${gap.documentId}`;
  }

  async function raiseQueryFromGap(gap: DocumentationGap) {
    await createQuery(gap.suggestedQuery);
    setDismissedGapKeys((prev) => new Set(prev).add(gapKey(gap)));
  }

  function dismissGap(gap: DocumentationGap) {
    setDismissedGapKeys((prev) => new Set(prev).add(gapKey(gap)));
  }

  async function createQuery(
    question: string,
    clinicalIndicators?: string,
    relatedCode?: string,
    relatedCodeSystem?: string
  ) {
    await queriesApi.create(encounterId, question, clinicalIndicators, relatedCode, relatedCodeSystem);
    loadQueries();
  }

  async function sendQuery(queryId: number) {
    await queriesApi.send(queryId);
    loadQueries();
    load();
  }

  async function resolveQuery(queryId: number) {
    await queriesApi.resolve(queryId);
    loadQueries();
    load();
  }

  useEffect(() => {
    if (dxQuery.trim().length < 2) {
      setDxResults([]);
      return;
    }
    const handle = setTimeout(() => {
      encoderApi.searchIcd10Cm(dxQuery).then(setDxResults).catch(() => setDxResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [dxQuery]);

  useEffect(() => {
    if (pxQuery.trim().length < 2) {
      setPxResults([]);
      return;
    }
    const handle = setTimeout(() => {
      encoderApi.searchIcd10Pcs(pxQuery).then(setPxResults).catch(() => setPxResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [pxQuery]);

  useEffect(() => {
    if (encounter?.status === "FINALIZED") return;
    if (diagnoses.length === 0) {
      setDrgPreview(null);
      return;
    }
    grouperApi.preview(diagnoses, procedures).then(setDrgPreview).catch(() => setDrgPreview(null));
  }, [diagnoses, procedures, encounter?.status]);

  function addDiagnosis(result: Icd10CmResult) {
    if (diagnoses.some((d) => d.code === result.code)) return;
    const hasPrincipal = diagnoses.some((d) => d.role === "principal");
    setDiagnoses([
      ...diagnoses,
      {
        code: result.code,
        codeSystem: "ICD-10-CM",
        codeVersion: CODE_VERSION,
        role: hasPrincipal ? "secondary" : "principal",
        presentOnAdmission: true,
      },
    ]);
    setDxQuery("");
    setDxResults([]);
  }

  function addProcedure(result: Icd10PcsResult) {
    if (procedures.some((p) => p.code === result.code)) return;
    setProcedures([...procedures, { code: result.code, codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION }]);
    setPxQuery("");
    setPxResults([]);
  }

  const [dismissedSuggestionCodes, setDismissedSuggestionCodes] = useState<Set<string>>(new Set());

  function acceptSuggestion(s: CodeSuggestion) {
    if (s.codeSystem === "ICD-10-CM") {
      if (diagnoses.some((d) => d.code === s.code)) return;
      const hasPrincipal = diagnoses.some((d) => d.role === "principal");
      setDiagnoses([
        ...diagnoses,
        {
          code: s.code,
          codeSystem: "ICD-10-CM",
          codeVersion: CODE_VERSION,
          role: hasPrincipal ? "secondary" : "principal",
          presentOnAdmission: true,
        },
      ]);
    } else {
      if (procedures.some((p) => p.code === s.code)) return;
      setProcedures([...procedures, { code: s.code, codeSystem: "ICD-10-PCS", codeVersion: CODE_VERSION }]);
    }
    setDismissedSuggestionCodes((prev) => new Set(prev).add(s.code));
  }

  /** Persisted, encounter-level, and one-way (no undo) — a rejected
   *  suggestion won't resurface for any coder who reopens this chart, unlike
   *  the old session-only "Dismiss" it replaces. */
  async function rejectSuggestion(s: CodeSuggestion) {
    await suggestionsApi.reject(encounterId, s.code, s.codeSystem);
    loadSuggestions();
    loadChartSummary();
  }

  /** Doesn't accept the suggested code as-is — instead re-focuses the
   *  matching search box on the suggestion's own term, so the coder can
   *  pick a more specific real code themselves rather than the suggestion
   *  being blindly accepted or having to be typed from scratch. */
  function modifySuggestion(s: CodeSuggestion) {
    if (s.codeSystem === "ICD-10-CM") {
      setDxQuery(s.matchedVia);
      document.getElementById("dx-search-input")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("dx-search-input")?.focus();
    } else {
      setPxQuery(s.matchedVia);
      document.getElementById("px-search-input")?.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("px-search-input")?.focus();
    }
  }

  /** A pending investigation, not a final decision — raises a real query
   *  (same mechanism as Documentation Gaps' "Raise Query") and hides the
   *  suggestion for this session only, since it isn't resolved yet. */
  async function queryFromSuggestion(s: CodeSuggestion) {
    await createQuery(
      `Does the documentation support coding ${s.description} (${s.code})?`,
      `"${s.evidenceExcerpt}"`,
      s.code,
      s.codeSystem
    );
    setDismissedSuggestionCodes((prev) => new Set(prev).add(s.code));
  }

  function setPrincipal(code: string) {
    setDiagnoses(diagnoses.map((d) => ({ ...d, role: d.code === code ? "principal" : "secondary" })));
  }

  function removeDiagnosis(code: string) {
    const removed = diagnoses.find((d) => d.code === code);
    const remaining = diagnoses.filter((d) => d.code !== code);
    // Removing the principal diagnosis must not leave the encounter with
    // none — auto-promote whichever diagnosis is now first, matching what
    // a coder would expect rather than requiring an extra manual click
    // (found during the Phase 1-7 end-to-end test pass, see docs/TEST_REPORT.md).
    if (removed?.role === "principal" && remaining.length > 0) {
      setDiagnoses(remaining.map((d, i) => ({ ...d, role: i === 0 ? "principal" : "secondary" })));
    } else {
      setDiagnoses(remaining);
    }
  }

  function removeProcedure(code: string) {
    setProcedures(procedures.filter((p) => p.code !== code));
  }

  async function saveDraft() {
    setStatusMessage(null);
    try {
      await codingApi.saveDraft(encounterId, { encounterId, diagnoses, procedures });
      setStatusIsError(false);
      setStatusMessage("Draft saved.");
      load();
      loadChartSummary();
    } catch (e) {
      setStatusIsError(true);
      setStatusMessage(`Save failed: ${String(e)}`);
    }
  }

  async function finalize() {
    setStatusMessage(null);
    try {
      await codingApi.finalize(encounterId);
      setStatusIsError(false);
      setStatusMessage("Encounter finalized.");
      load();
      // Finalizing can trigger a new QA sample server-side (see
      // QaService.maybeSampleForReview) — without this, a stale RETURNED
      // review from a prior cycle would keep showing even after a fresh
      // PENDING review superseded it. Found by testing the actual
      // recode-and-refinalize loop, not by inspection.
      loadQaReviews();
    } catch (e) {
      setStatusIsError(true);
      setStatusMessage(`Finalize failed: ${String(e)}`);
    }
  }

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!encounter) return <div className="p-6 text-sm text-slate-400">Loading encounter...</div>;

  // Locked from coder editing in both terminal states — QA_REVIEW means the
  // encounter is finalized and currently sitting with an auditor; editing it
  // out from under a review in progress would corrupt what's being reviewed.
  const isFinalized = encounter.status === "FINALIZED" || encounter.status === "QA_REVIEW";
  const codedCodes = new Set([...diagnoses.map((d) => d.code), ...procedures.map((p) => p.code)]);
  const visibleSuggestions = suggestions.filter(
    (s) => !codedCodes.has(s.code) && !dismissedSuggestionCodes.has(s.code)
  );
  const visibleGaps = documentationGaps.filter((g) => !dismissedGapKeys.has(gapKey(g)));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-1">
        <Link to="/" className="text-xs text-slate-400 hover:text-brand-700">
          Work Queue
        </Link>
        <span className="text-xs text-slate-300">/</span>
        <span className="text-xs text-slate-500">Encounter #{encounter.id}</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">
            {encounter.patient.mrn}
            <span className="text-slate-400 font-normal"> · Encounter #{encounter.id}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Admitted {encounter.admissionDate.slice(0, 10)} · Discharged{" "}
            {encounter.dischargeDate?.slice(0, 10) ?? "—"}
          </p>
        </div>
        <StatusBadge status={encounter.status} />
      </div>

      <ChartReviewSummary summary={chartSummary} gapCount={visibleGaps.length} changes={chartChanges} />

      <ChartChangesBanner summary={chartChanges} />

      {chartSummary && (
        <div className="mb-5">
          <ChartIntelligencePanel summary={chartSummary} onJumpToEvidence={jumpToEvidence} />
        </div>
      )}

      <div className="mb-5">
        <DrgPanel
          preview={
            isFinalized
              ? encounter.codingDecision?.msDrg
                ? {
                    drg: encounter.codingDecision.msDrg,
                    description: encounter.codingDecision.msDrgDescription ?? "",
                    severity: "NONE",
                    isSurgical: false,
                  }
                : null
              : drgPreview
          }
          finalized={isFinalized}
        />
      </div>

      {/* qaReviews is ordered newest-first by the API — only the most recent
          review is relevant; an old RETURNED reason shouldn't resurface
          after the encounter has since been recoded and re-approved. */}
      {qaReviews[0]?.status === "RETURNED" && (
        <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4">
          <h2 className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
            Returned from QA Review
          </h2>
          <p className="text-xs text-red-700">{qaReviews[0].reason}</p>
        </div>
      )}

      {!isFinalized && visibleGaps.length > 0 && (
        <div className="mb-5">
          <DocumentationGapsPanel
            gaps={visibleGaps}
            onRaiseQuery={raiseQueryFromGap}
            onDismiss={dismissGap}
            disabled={isFinalized}
          />
        </div>
      )}

      {!isFinalized && visibleSuggestions.length > 0 && (
        <div className="mb-5">
          <SuggestionsPanel
            suggestions={visibleSuggestions}
            onAccept={acceptSuggestion}
            onReject={rejectSuggestion}
            onModify={modifySuggestion}
            onQuery={queryFromSuggestion}
            onExplain={(s) => openExplanation(s.code, s.codeSystem)}
            disabled={isFinalized}
          />
        </div>
      )}

      <div className="mb-5">
        <QueriesPanel
          queries={queries}
          onCreate={createQuery}
          onSend={sendQuery}
          onResolve={resolveQuery}
          disabled={isFinalized}
        />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Documentation</h2>
          </div>
          <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
            {encounter.documents.map((doc) => (
              <div
                key={doc.id}
                id={`doc-${doc.id}`}
                className={`border rounded-lg p-3 transition-colors duration-500 ${
                  highlightedDocId === doc.id ? "border-amber-400 bg-amber-50" : "border-slate-200"
                }`}
              >
                <div className="text-xs font-medium text-brand-700 mb-1.5">
                  {doc.type.replaceAll("_", " ")}
                </div>
                <pre className="text-xs whitespace-pre-wrap font-sans text-slate-700 leading-relaxed">
                  {doc.content}
                </pre>
              </div>
            ))}
          </div>
        </section>

        <div className="space-y-5">
          <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Diagnoses <span className="text-slate-400 normal-case font-normal">ICD-10-CM</span>
              </h2>
            </div>
            <div className="p-4">
              {!isFinalized && (
                <div className="relative mb-3">
                  <input
                    id="dx-search-input"
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-shadow"
                    placeholder="Search diagnosis (e.g. pneumonia, J189)..."
                    value={dxQuery}
                    onChange={(e) => setDxQuery(e.target.value)}
                  />
                  {dxResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-card mt-1 max-h-64 overflow-y-auto">
                      {dxResults.map((r) => (
                        <button
                          key={r.code}
                          className="block w-full text-left text-xs px-3 py-2 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent border-b border-slate-50 last:border-0"
                          disabled={!r.isBillable}
                          onClick={() => addDiagnosis(r)}
                        >
                          <span className="font-mono font-medium text-slate-700">{r.code}</span>{" "}
                          <span className="text-slate-600">— {r.longDescription}</span>
                          {!r.isBillable && <span className="text-slate-400"> (not billable)</span>}
                          {r.matchedVia && (
                            <div className="text-slate-400 pl-1 mt-0.5 italic">via index: "{r.matchedVia}"</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {diagnoses.map((d) => (
                  <div
                    key={d.code}
                    className="flex items-center gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2"
                  >
                    <span className="font-mono font-medium text-slate-800">{d.code}</span>
                    <button
                      className="text-slate-400 hover:text-brand-700 transition-colors underline decoration-dotted"
                      onClick={() => openExplanation(d.code, "ICD-10-CM")}
                    >
                      why?
                    </button>
                    <label className="flex items-center gap-1 text-slate-600">
                      <input
                        type="radio"
                        name="principal"
                        checked={d.role === "principal"}
                        disabled={isFinalized}
                        onChange={() => setPrincipal(d.code)}
                      />
                      Principal
                    </label>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs ${
                        d.presentOnAdmission ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {d.presentOnAdmission ? "POA" : "not POA"}
                    </span>
                    {!isFinalized && (
                      <button
                        className="ml-auto text-slate-400 hover:text-red-600 transition-colors"
                        onClick={() => removeDiagnosis(d.code)}
                      >
                        remove
                      </button>
                    )}
                  </div>
                ))}
                {diagnoses.length === 0 && (
                  <div className="text-xs text-slate-400 py-1">No diagnoses assigned yet.</div>
                )}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                Procedures <span className="text-slate-400 normal-case font-normal">ICD-10-PCS</span>
              </h2>
            </div>
            <div className="p-4">
              {!isFinalized && (
                <div className="relative mb-3">
                  <input
                    id="px-search-input"
                    className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-shadow"
                    placeholder="Search procedure..."
                    value={pxQuery}
                    onChange={(e) => setPxQuery(e.target.value)}
                  />
                  {pxResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-card mt-1 max-h-64 overflow-y-auto">
                      {pxResults.map((r) => (
                        <button
                          key={r.code}
                          className="block w-full text-left text-xs px-3 py-2 hover:bg-brand-50 disabled:opacity-40 disabled:hover:bg-transparent border-b border-slate-50 last:border-0"
                          disabled={!r.isBillable}
                          onClick={() => addProcedure(r)}
                        >
                          <span className="font-mono font-medium text-slate-700">{r.code}</span>{" "}
                          <span className="text-slate-600">— {r.description}</span>
                          {!r.isBillable && <span className="text-slate-400"> (not billable)</span>}
                          {r.matchedVia && (
                            <div className="text-slate-400 pl-1 mt-0.5 italic">via index: "{r.matchedVia}"</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                {procedures.map((p) => (
                  <div
                    key={p.code}
                    className="flex items-center gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2"
                  >
                    <span className="font-mono font-medium text-slate-800">{p.code}</span>
                    <button
                      className="text-slate-400 hover:text-brand-700 transition-colors underline decoration-dotted"
                      onClick={() => openExplanation(p.code, "ICD-10-PCS")}
                    >
                      why?
                    </button>
                    {!isFinalized && (
                      <button
                        className="ml-auto text-slate-400 hover:text-red-600 transition-colors"
                        onClick={() => removeProcedure(p.code)}
                      >
                        remove
                      </button>
                    )}
                  </div>
                ))}
                {procedures.length === 0 && (
                  <div className="text-xs text-slate-400 py-1">No procedures assigned yet.</div>
                )}
              </div>
            </div>
          </section>

          {!isFinalized && (
            <div className="flex items-center gap-2">
              <button
                className="text-xs border border-slate-300 rounded-lg px-4 py-2 text-slate-700 hover:bg-slate-100 transition-colors"
                onClick={saveDraft}
              >
                Save Draft
              </button>
              <button
                className="text-xs bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 shadow-sm transition-colors"
                onClick={finalize}
                disabled={diagnoses.length === 0}
              >
                Finalize
              </button>
              {statusMessage && (
                <span className={`text-xs ${statusIsError ? "text-red-600" : "text-emerald-600"}`}>
                  {statusMessage}
                </span>
              )}
            </div>
          )}
          {isFinalized && statusMessage && (
            <span className={`text-xs ${statusIsError ? "text-red-600" : "text-emerald-600"}`}>{statusMessage}</span>
          )}
        </div>
      </div>

      {explanationOpen && (
        <DecisionExplanationCard
          explanation={explanation}
          loading={explanationLoading}
          onClose={closeExplanation}
          onJumpToEvidence={jumpToEvidence}
        />
      )}
    </div>
  );
}
