import { request } from "./http.js";

export type DocumentationGap = {
  indicatorName: string;
  extractedValue: number;
  unit: string | null;
  evidenceExcerpt: string;
  documentId: number;
  documentType: string;
  suggestedQuery: string;
};

export const documentationGapsApi = {
  list: (encounterId: number) => request<DocumentationGap[]>(`/encounters/${encounterId}/documentation-gaps`),
};
