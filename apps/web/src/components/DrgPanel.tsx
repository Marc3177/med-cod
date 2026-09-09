import type { DrgPreview } from "../api/grouper.js";

const SEVERITY_STYLE: Record<string, string> = {
  MCC: "bg-red-50 text-red-700 ring-red-300",
  CC: "bg-amber-50 text-amber-700 ring-amber-300",
  NONE: "bg-slate-100 text-slate-600 ring-slate-300",
};

export function DrgPanel({ preview, finalized }: { preview: DrgPreview; finalized: boolean }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
          {finalized ? "Assigned DRG" : "Estimated DRG"}
        </h2>
        <div className="flex items-center gap-2">
          {preview?.isSurgical && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset bg-brand-50 text-brand-700 ring-brand-300">
              Surgical
            </span>
          )}
          {preview && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_STYLE[preview.severity]}`}
            >
              {preview.severity === "NONE" ? "No CC/MCC" : preview.severity}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {!preview && (
          <p className="text-xs text-slate-400">
            Assign a principal diagnosis to see an estimated DRG. This is a simplified approximation, not the
            official CMS grouper.
          </p>
        )}
        {preview && (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-semibold text-slate-900 font-mono">{preview.drg}</span>
              <span className="text-xs text-slate-600">{preview.description}</span>
            </div>
            {preview.procedureDrivenBy && (
              <p className="text-xs text-slate-400 mt-1.5 italic">
                Surgical DRG triggered by procedure {preview.procedureDrivenBy}
              </p>
            )}
            {preview.severityDrivenBy && (
              <p className="text-xs text-slate-400 mt-1 italic">
                Severity driven by secondary diagnosis {preview.severityDrivenBy}
              </p>
            )}
            <p className="text-xs text-slate-400 mt-2">
              Simplified approximation — not the official CMS MS-DRG grouper.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
