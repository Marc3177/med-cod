import { useEffect, useState } from "react";
import { reportingApi, type ReportingSummary } from "../api/reporting.js";

function pct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(0)}%`;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold text-slate-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function Reports() {
  const [summary, setSummary] = useState<ReportingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    reportingApi
      .summary()
      .then(setSummary)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!summary) return <div className="p-6 text-sm text-slate-400">Loading reports...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-lg font-semibold text-slate-900 mb-1">Reports</h1>
      <p className="text-xs text-slate-500 mb-5">
        Real metrics computed from current data — nothing here is a mock number.
      </p>

      <div className="grid grid-cols-4 gap-4 mb-5">
        <StatTile
          label="First-Pass Acceptance"
          value={pct(summary.firstPassAcceptanceRate)}
          sub={`${summary.finalizedEncounterCount} currently finalized`}
        />
        <StatTile
          label="Specificity Capture"
          value={pct(summary.specificityCaptureRate)}
          sub="non-'unspecified' diagnosis codes"
        />
        <StatTile
          label="QA Return Rate"
          value={pct(summary.qa.returnRate)}
          sub={`${summary.qa.totalReviews} reviews total`}
        />
        <StatTile
          label="Query Turnaround"
          value={summary.queries.avgTurnaroundHours === null ? "—" : `${summary.queries.avgTurnaroundHours.toFixed(1)}h`}
          sub={`${summary.queries.total} queries raised`}
        />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Coder Productivity</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Coder</th>
                <th className="px-4 py-2 font-medium">Finalized</th>
              </tr>
            </thead>
            <tbody>
              {summary.coderProductivity.map((c) => (
                <tr key={c.userId} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-slate-700">{c.email}</td>
                  <td className="px-4 py-2 text-slate-700">{c.finalizedCount}</td>
                </tr>
              ))}
              {summary.coderProductivity.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-slate-400">
                    No finalizations yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
            <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Pipeline Workload</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(summary.workloadByStatus).map(([status, count]) => (
                <tr key={status} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-2 text-slate-700">{status.replaceAll("_", " ")}</td>
                  <td className="px-4 py-2 text-slate-700">{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
