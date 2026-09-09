import type { ChartSummary } from "../api/chartIntelligence.js";
import type { ChartChangeSummary } from "../api/chartChanges.js";

function Tile({ icon, count, label, tone }: { icon: string; count: number; label: string; tone: "neutral" | "warn" | "info" }) {
  const toneClass =
    tone === "warn" ? "text-amber-700" : tone === "info" ? "text-sky-700" : "text-emerald-700";
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span aria-hidden className={toneClass}>
        {icon}
      </span>
      <span className={`font-semibold ${toneClass}`}>{count}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

export function ChartReviewSummary({
  summary,
  gapCount,
  changes,
}: {
  summary: ChartSummary | null;
  gapCount: number;
  changes: ChartChangeSummary | null;
}) {
  if (!summary) return null;

  const evidenceSourceCount = new Set(summary.potentialFindings.map((f) => f.documentId)).size;
  const changeCount = changes?.isFirstView ? 0 : (changes?.changes.length ?? 0);

  return (
    <section className="mb-5 bg-white rounded-xl border border-slate-200 shadow-card px-4 py-3">
      <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2.5">Chart Review</h2>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        <Tile icon="✓" count={summary.confirmedFindings.length} label="confirmed coded conditions" tone="neutral" />
        <Tile icon="⚠" count={summary.potentialFindings.length} label="potential coding opportunities" tone="warn" />
        <Tile icon="⚠" count={gapCount} label="documentation gaps" tone="warn" />
        {changeCount > 0 && <Tile icon="🔄" count={changeCount} label="changes since last visit" tone="info" />}
        <Tile icon="🔎" count={evidenceSourceCount} label="evidence sources" tone="neutral" />
      </div>
    </section>
  );
}
