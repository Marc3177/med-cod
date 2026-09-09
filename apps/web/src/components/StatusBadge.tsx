const STYLES: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-600 ring-slate-300",
  IN_PROGRESS: "bg-amber-50 text-amber-700 ring-amber-300",
  QUERY_PENDING: "bg-orange-50 text-orange-700 ring-orange-300",
  QA_REVIEW: "bg-violet-50 text-violet-700 ring-violet-300",
  FINALIZED: "bg-emerald-50 text-emerald-700 ring-emerald-300",
};

const LABELS: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In Progress",
  QUERY_PENDING: "Query Pending",
  QA_REVIEW: "QA Review",
  FINALIZED: "Finalized",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-slate-100 text-slate-600 ring-slate-300";
  const label = LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>
      {label}
    </span>
  );
}
