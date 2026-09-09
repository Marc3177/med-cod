import { useEffect, useState } from "react";
import { qaApi, type PendingQaReview } from "../api/qa.js";

export function AuditorQueue() {
  const [reviews, setReviews] = useState<PendingQaReview[] | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  function load() {
    qaApi.auditor
      .listPending()
      .then(setReviews)
      .catch((e) => setError(String(e)));
  }

  useEffect(load, []);

  async function approve(reviewId: number) {
    await qaApi.auditor.approve(reviewId);
    load();
  }

  async function returnToCoder(reviewId: number) {
    const reason = (drafts[reviewId] ?? "").trim();
    if (reason.length === 0) return;
    await qaApi.auditor.returnToCoder(reviewId, reason);
    setDrafts((prev) => ({ ...prev, [reviewId]: "" }));
    load();
  }

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!reviews) return <div className="p-6 text-sm text-slate-400">Loading QA queue...</div>;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">QA Review Queue</h1>
      <p className="text-xs text-slate-500 mb-4">
        {reviews.length} encounter{reviews.length === 1 ? "" : "s"} sampled for review
      </p>

      <div className="space-y-4">
        {reviews.map((r) => (
          <div key={r.id} className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
            <div className="text-xs text-slate-400 mb-1">
              Patient {r.encounter.patient.mrn} · Encounter #{r.encounterId}
            </div>
            <div className="text-sm text-slate-800 mb-2">
              DRG {r.encounter.codingDecision?.msDrg ?? "—"} — {r.encounter.codingDecision?.msDrgDescription ?? ""}
            </div>
            <textarea
              className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
              rows={2}
              placeholder="Reason (required only to return to coder)..."
              value={drafts[r.id] ?? ""}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
            />
            <div className="flex gap-2 mt-2">
              <button
                className="text-xs border border-slate-300 rounded-lg px-3 py-1.5 text-red-700 hover:bg-red-50"
                onClick={() => returnToCoder(r.id)}
              >
                Return to Coder
              </button>
              <button
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5"
                onClick={() => approve(r.id)}
              >
                Approve
              </button>
            </div>
          </div>
        ))}
        {reviews.length === 0 && <div className="text-xs text-slate-400">No encounters pending QA review.</div>}
      </div>
    </div>
  );
}
