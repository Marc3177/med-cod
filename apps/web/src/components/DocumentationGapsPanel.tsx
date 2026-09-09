import type { DocumentationGap } from "../api/documentationGaps.js";

export function DocumentationGapsPanel({
  gaps,
  onRaiseQuery,
  onDismiss,
  disabled,
}: {
  gaps: DocumentationGap[];
  onRaiseQuery: (gap: DocumentationGap) => void;
  onDismiss: (gap: DocumentationGap) => void;
  disabled: boolean;
}) {
  if (gaps.length === 0) return null;

  return (
    <section className="bg-white rounded-xl border border-amber-200 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
        <h2 className="text-xs font-semibold text-amber-800 uppercase tracking-wide">
          Potential Documentation Gaps{" "}
          <span className="text-amber-600 normal-case font-normal">
            — a value is documented, nothing coded addresses it yet
          </span>
        </h2>
      </div>
      <div className="divide-y divide-amber-50">
        {gaps.map((g, i) => (
          <div key={`${g.indicatorName}-${g.documentId}-${i}`} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-800">
                  {g.indicatorName}: {g.extractedValue}
                  {g.unit ? ` ${g.unit}` : ""}
                </div>
                <blockquote className="text-xs text-slate-500 italic border-l-2 border-amber-200 pl-2 mt-1.5">
                  "{g.evidenceExcerpt}"
                </blockquote>
                <div className="text-xs text-slate-600 mt-1.5">{g.suggestedQuery}</div>
                <div className="text-xs text-slate-400 mt-1">{g.documentType.replaceAll("_", " ")}</div>
              </div>
              {!disabled && (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-600 hover:bg-slate-100 transition-colors"
                    onClick={() => onDismiss(g)}
                  >
                    Dismiss
                  </button>
                  <button
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white rounded px-2 py-1 transition-colors"
                    onClick={() => onRaiseQuery(g)}
                  >
                    Raise Query
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
