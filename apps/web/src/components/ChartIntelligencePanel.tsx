import type { ChartSummary } from "../api/chartIntelligence.js";

export function ChartIntelligencePanel({
  summary,
  onJumpToEvidence,
}: {
  summary: ChartSummary;
  onJumpToEvidence: (documentId: number) => void;
}) {
  const hasAnyFindings = summary.confirmedFindings.length > 0 || summary.potentialFindings.length > 0;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Chart Intelligence</h2>
        <div className="text-xs text-slate-500">
          {summary.documentCount} document{summary.documentCount === 1 ? "" : "s"}
          {summary.documentationGapCount > 0 && (
            <span className="text-amber-600 ml-2">
              · {summary.documentationGapCount} potential gap{summary.documentationGapCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {!hasAnyFindings && (
          <p className="text-xs text-slate-400">No clinical concepts detected yet.</p>
        )}

        {summary.confirmedFindings.length > 0 && (
          <div className="mb-3">
            <div className="flex flex-wrap gap-1.5">
              {summary.confirmedFindings.map((f) => (
                <span
                  key={f.code}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-300"
                  title={`${f.code} — ${f.description}`}
                >
                  <span aria-hidden>✓</span> {f.description}
                </span>
              ))}
            </div>
          </div>
        )}

        {summary.potentialFindings.length > 0 && (
          <div>
            <div className="flex flex-wrap gap-1.5">
              {summary.potentialFindings.map((f) => (
                <button
                  key={f.code}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-100 transition-colors"
                  title={`${f.code} — ${f.description}\nvia "${f.matchedVia}"\nClick to view source text`}
                  onClick={() => onJumpToEvidence(f.documentId)}
                >
                  <span aria-hidden>⚠</span> {f.description}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
