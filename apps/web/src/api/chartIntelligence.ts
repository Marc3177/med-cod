import { request } from "./http.js";

export type ChartFinding = {
  code: string;
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  description: string;
};

export type ChartPotentialFinding = ChartFinding & {
  evidenceExcerpt: string;
  documentId: number;
  matchedVia: string;
};

export type ChartSummary = {
  documentCount: number;
  confirmedFindings: ChartFinding[];
  potentialFindings: ChartPotentialFinding[];
  documentationGapCount: number;
};

export const chartIntelligenceApi = {
  getSummary: (encounterId: number) => request<ChartSummary>(`/encounters/${encounterId}/chart-summary`),
};
