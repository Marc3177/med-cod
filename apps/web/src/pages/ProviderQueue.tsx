import { useEffect, useState } from "react";
import { queriesApi, type PendingProviderQuery } from "../api/queries.js";

export function ProviderQueue() {
  const [queries, setQueries] = useState<PendingProviderQuery[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  function load() {
    queriesApi.provider
      .listPending()
      .then(setQueries)
      .catch((e) => setError(String(e)));
  }

  useEffect(load, []);

  async function submit(queryId: number) {
    const response = (drafts[queryId] ?? "").trim();
    if (response.length === 0) return;
    await queriesApi.provider.respond(queryId, response);
    setDrafts((prev) => ({ ...prev, [queryId]: "" }));
    load();
  }

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!queries) return <div className="p-6 text-sm text-slate-400">Loading queries...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Pending Queries</h1>
      <p className="text-xs text-slate-500 mb-4">
        {queries.length} question{queries.length === 1 ? "" : "s"} awaiting your response
      </p>

      <div className="space-y-4">
        {queries.map((q) => (
          <div key={q.id} className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
            <div className="text-xs text-slate-400 mb-1">Patient {q.encounter.patient.mrn}</div>
            <div className="text-sm text-slate-800 mb-2">{q.question}</div>
            {q.clinicalIndicators && (
              <div className="text-xs text-slate-500 mb-3">Clinical indicators: {q.clinicalIndicators}</div>
            )}
            <textarea
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              rows={3}
              placeholder="Your response..."
              value={drafts[q.id] ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
            />
            <button
              className="mt-2 text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-3 py-1.5"
              onClick={() => submit(q.id)}
            >
              Submit Response
            </button>
          </div>
        ))}
        {queries.length === 0 && <div className="text-xs text-slate-400">No pending queries.</div>}
      </div>
    </div>
  );
}
