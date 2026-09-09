import type { ChartChange, ChartChangeSummary } from "../api/chartChanges.js";

const CODING_ACTION_LABEL: Record<string, string> = {
  CREATE_DRAFT: "saved a first coding draft",
  UPDATE_DRAFT: "updated the coding draft",
  FINALIZE: "finalized this encounter",
};

function describe(change: ChartChange): string {
  switch (change.type) {
    case "NEW_DOCUMENT":
      return `New document added: ${change.documentType.replace(/_/g, " ").toLowerCase()}`;
    case "CODING_UPDATED":
      return `Another user ${CODING_ACTION_LABEL[change.action] ?? "changed the coding"}`;
    case "QUERY_RESPONDED":
      return "A provider responded to a query";
    case "QA_RETURNED":
      return `QA returned this encounter${change.reason ? `: ${change.reason}` : ""}`;
  }
}

export function ChartChangesBanner({ summary }: { summary: ChartChangeSummary | null }) {
  if (!summary || summary.isFirstView || summary.changes.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3">
      <p className="text-xs font-semibold text-sky-800 uppercase tracking-wide mb-1.5">
        Changed since your last visit
      </p>
      <ul className="space-y-0.5">
        {summary.changes.map((change, i) => (
          <li key={i} className="text-xs text-sky-900">
            {describe(change)}
          </li>
        ))}
      </ul>
    </div>
  );
}
