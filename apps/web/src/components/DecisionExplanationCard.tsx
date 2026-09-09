import type { DecisionExplanation } from "../api/decisionExplanation.js";

function CheckRow({ ok, okLabel, warnLabel }: { ok: boolean; okLabel: string; warnLabel: string }) {
  return (
    <div className={`flex items-start gap-1.5 text-xs ${ok ? "text-emerald-700" : "text-amber-700"}`}>
      <span aria-hidden>{ok ? "✓" : "⚠"}</span>
      <span>{ok ? okLabel : warnLabel}</span>
    </div>
  );
}

export function DecisionExplanationCard({
  explanation,
  loading,
  onClose,
  onJumpToEvidence,
}: {
  explanation: DecisionExplanation | null;
  loading: boolean;
  onClose: () => void;
  onJumpToEvidence: (documentId: number) => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Candidate Code</h2>
          <button className="text-slate-400 hover:text-slate-700 text-xs" onClick={onClose}>
            close
          </button>
        </div>

        <div className="p-4">
          {loading && <p className="text-xs text-slate-400">Loading…</p>}

          {!loading && explanation && (
            <>
              <div className="text-sm mb-3">
                <span className="font-mono font-semibold text-slate-800">{explanation.code}</span>{" "}
                <span className="text-slate-400 text-xs">({explanation.codeSystem})</span>
                <div className="text-slate-700 text-xs mt-0.5">{explanation.description}</div>
              </div>

              <div className="space-y-1 mb-3 border-t border-slate-100 pt-3">
                <CheckRow ok={explanation.isBillable} okLabel="Billable code" warnLabel="Not a billable code" />
                <CheckRow
                  ok={explanation.checks.specific}
                  okLabel="Specific — not an unspecified code"
                  warnLabel="Description says “unspecified” — check documentation for a more specific option"
                />
                {explanation.checks.ccMcc ? (
                  <div className="flex items-start gap-1.5 text-xs text-sky-700">
                    <span aria-hidden>ℹ</span>
                    <span>Flagged as {explanation.checks.ccMcc} — affects DRG severity if coded as secondary</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5 text-xs text-slate-400">
                    <span aria-hidden>–</span>
                    <span>No CC/MCC impact</span>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-500 mb-1.5">
                  Evidence{explanation.evidence.length > 0 && ` (${explanation.evidence.length})`}
                </p>
                {explanation.evidence.length > 0 ? (
                  <div className="space-y-2">
                    {explanation.evidence.map((e, i) => (
                      <button
                        key={i}
                        className="text-left w-full hover:bg-slate-50 rounded-lg p-2 -m-2 transition-colors block"
                        onClick={() => {
                          onJumpToEvidence(e.documentId);
                          onClose();
                        }}
                      >
                        <blockquote className="text-xs text-slate-600 italic border-l-2 border-slate-200 pl-2">
                          "{e.excerpt}"
                        </blockquote>
                        <div className="text-xs text-slate-400 mt-1">
                          {e.documentType.replaceAll("_", " ")} · matched via "{e.matchedVia}" — click to view in
                          Documentation
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Added directly by a coder — not matched from a documentation excerpt.
                  </p>
                )}
              </div>

              {explanation.relatedQueries.length > 0 && (
                <div className="border-t border-slate-100 pt-3 mt-3">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Queries about this code ({explanation.relatedQueries.length})
                  </p>
                  <div className="space-y-1.5">
                    {explanation.relatedQueries.map((q) => (
                      <div key={q.id} className="text-xs flex items-start gap-1.5">
                        <span className="text-amber-700 shrink-0">{q.status}</span>
                        <span className="text-slate-600">{q.question}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
