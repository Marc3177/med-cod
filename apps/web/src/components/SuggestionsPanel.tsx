import type { CodeSuggestion } from "../api/suggestions.js";

export function SuggestionsPanel({
  suggestions,
  onAccept,
  onReject,
  onModify,
  onQuery,
  onExplain,
  disabled,
}: {
  suggestions: CodeSuggestion[];
  onAccept: (s: CodeSuggestion) => void;
  onReject: (s: CodeSuggestion) => void;
  onModify: (s: CodeSuggestion) => void;
  onQuery: (s: CodeSuggestion) => void;
  onExplain: (s: CodeSuggestion) => void;
  disabled: boolean;
}) {
  if (suggestions.length === 0) return null;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
        <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          Suggested from Documentation{" "}
          <span className="text-slate-400 normal-case font-normal">— review each, nothing is auto-added</span>
        </h2>
      </div>
      <div className="divide-y divide-slate-100">
        {suggestions.map((s) => (
          <div key={`${s.codeSystem}-${s.code}`} className="p-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-xs">
                  <span className="font-mono font-medium text-slate-800">{s.code}</span>{" "}
                  <span className="text-slate-500">({s.codeSystem})</span> — {s.description}
                </div>
                <blockquote className="text-xs text-slate-500 italic border-l-2 border-slate-200 pl-2 mt-1.5">
                  "{s.evidenceExcerpt}"
                </blockquote>
                <div className="text-xs text-slate-400 mt-1">
                  {s.documentType.replaceAll("_", " ")} · matched via "{s.matchedVia}"
                </div>
              </div>
              {!disabled && (
                <div className="flex gap-1.5 shrink-0 flex-wrap">
                  <button
                    className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-600 hover:bg-slate-100 transition-colors"
                    onClick={() => onExplain(s)}
                  >
                    Why?
                  </button>
                  <button
                    className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-600 hover:bg-slate-100 transition-colors"
                    onClick={() => onQuery(s)}
                  >
                    Query
                  </button>
                  <button
                    className="text-xs border border-slate-300 rounded px-2 py-1 text-slate-600 hover:bg-slate-100 transition-colors"
                    onClick={() => onModify(s)}
                  >
                    Modify
                  </button>
                  <button
                    className="text-xs border border-red-200 rounded px-2 py-1 text-red-600 hover:bg-red-50 transition-colors"
                    onClick={() => onReject(s)}
                  >
                    Reject
                  </button>
                  <button
                    className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded px-2 py-1 transition-colors"
                    onClick={() => onAccept(s)}
                  >
                    Accept
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
