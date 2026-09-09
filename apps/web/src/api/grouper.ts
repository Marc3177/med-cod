import { request } from "./http.js";
import type { CodedDiagnosis, CodedProcedure } from "./types.js";

export type DrgPreview = {
  drg: string;
  description: string;
  severity: "MCC" | "CC" | "NONE";
  isSurgical: boolean;
  severityDrivenBy?: string;
  procedureDrivenBy?: string;
} | null;

export const grouperApi = {
  preview: (diagnoses: CodedDiagnosis[], procedures: CodedProcedure[] = []) =>
    request<DrgPreview>("/grouper/preview", {
      method: "POST",
      body: JSON.stringify({ diagnoses, procedures }),
    }),
};
