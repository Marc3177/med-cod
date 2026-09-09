import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { patientsApi } from "../api/patients.js";
import type { Encounter } from "../api/types.js";
import { StatusBadge } from "../components/StatusBadge.js";

export function WorkQueue() {
  const [encounters, setEncounters] = useState<Encounter[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    patientsApi.workQueue().then(setEncounters).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="p-6 text-sm text-red-700">{error}</div>;
  if (!encounters)
    return <div className="p-6 text-sm text-slate-400">Loading work queue...</div>;

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Work Queue</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {encounters.length} case{encounters.length === 1 ? "" : "s"} awaiting coding
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wide">
              <th className="py-2.5 px-4 font-medium">Case</th>
              <th className="py-2.5 px-4 font-medium">MRN</th>
              <th className="py-2.5 px-4 font-medium">Admission</th>
              <th className="py-2.5 px-4 font-medium">Discharge</th>
              <th className="py-2.5 px-4 font-medium">Admitting Dx</th>
              <th className="py-2.5 px-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {encounters.map((e, i) => (
              <tr
                key={e.id}
                className={`border-b border-slate-100 last:border-0 hover:bg-brand-50/40 transition-colors ${
                  i % 2 === 1 ? "bg-slate-50/40" : ""
                }`}
              >
                <td className="py-2.5 px-4">
                  <Link
                    to={`/encounters/${e.id}`}
                    className="font-medium text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    #{e.id}
                  </Link>
                </td>
                <td className="py-2.5 px-4 font-mono text-slate-600">{e.patient.mrn}</td>
                <td className="py-2.5 px-4 text-slate-600">{e.admissionDate.slice(0, 10)}</td>
                <td className="py-2.5 px-4 text-slate-600">{e.dischargeDate?.slice(0, 10) ?? "—"}</td>
                <td className="py-2.5 px-4 text-slate-700">{e.admittingDiagnosis ?? "—"}</td>
                <td className="py-2.5 px-4">
                  <StatusBadge status={e.status} />
                </td>
              </tr>
            ))}
            {encounters.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No cases in the queue. Nice work.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
