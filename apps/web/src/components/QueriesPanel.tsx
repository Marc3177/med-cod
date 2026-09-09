import { useState } from "react";
import type { CodingQuery } from "../api/queries.js";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600 ring-slate-300",
  SENT: "bg-amber-50 text-amber-700 ring-amber-300",
  RESPONDED: "bg-brand-50 text-brand-700 ring-brand-300",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-300",
  EXPIRED: "bg-red-50 text-red-700 ring-red-300",
};

export function QueriesPanel({
  queries,
  onCreate,
  onSend,
  onResolve,
  disabled,
}: {
  queries: CodingQuery[];
  onCreate: (question: string, clinicalIndicators?: string) => void;
  onSend: (id: number) => void;
  onResolve: (id: number) => void;
  disabled: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [indicators, setIndicators] = useState("");
  const [showForm, setShowForm] = useState(false);

  function submit() {
    if (question.trim().length === 0) return;
    onCreate(question.trim(), indicators.trim() || undefined);
    setQuestion("");
    setIndicators("");
    setShowForm(false);
  }

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Queries</h2>
        {!disabled && !showForm && (
          <button
            className="text-xs text-brand-700 hover:text-brand-800 hover:underline"
            onClick={() => setShowForm(true)}
          >
            + Raise Query
          </button>
        )}
      </div>

      {showForm && (
        <div className="p-4 border-b border-slate-100 space-y-2">
          <textarea
            className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            rows={2}
            placeholder="Question for the provider..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <textarea
            className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            rows={2}
            placeholder="Supporting clinical indicators (optional)..."
            value={indicators}
            onChange={(e) => setIndicators(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="text-xs border border-slate-300 rounded px-3 py-1.5 text-slate-600 hover:bg-slate-100"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded px-3 py-1.5"
              onClick={submit}
            >
              Save Query
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {queries.map((q) => (
          <div key={q.id} className="p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-800">
                  {q.question}
                  {q.relatedCode && (
                    <span className="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono bg-slate-100 text-slate-500">
                      Re: {q.relatedCode}
                    </span>
                  )}
                </div>
                {q.clinicalIndicators && (
                  <div className="text-xs text-slate-400 mt-1">Indicators: {q.clinicalIndicators}</div>
                )}
                {q.response && (
                  <blockquote className="text-xs text-slate-600 border-l-2 border-brand-200 pl-2 mt-2">
                    {q.response}
                  </blockquote>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[q.status]}`}
                >
                  {q.status}
                </span>
                {!disabled && q.status === "DRAFT" && (
                  <button
                    className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded px-2 py-1"
                    onClick={() => onSend(q.id)}
                  >
                    Send
                  </button>
                )}
                {!disabled && q.status === "RESPONDED" && (
                  <button
                    className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded px-2 py-1"
                    onClick={() => onResolve(q.id)}
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        {queries.length === 0 && !showForm && (
          <div className="p-3 text-xs text-slate-400">No queries raised for this encounter.</div>
        )}
      </div>
    </section>
  );
}
