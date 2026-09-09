import { request } from "./http.js";

export type CodeSuggestion = {
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  code: string;
  description: string;
  isBillable: boolean;
  evidenceExcerpt: string;
  documentId: number;
  documentType: string;
  matchedVia: string;
};

export const suggestionsApi = {
  list: (encounterId: number) => request<CodeSuggestion[]>(`/encounters/${encounterId}/suggestions`),
  reject: (encounterId: number, code: string, codeSystem: "ICD-10-CM" | "ICD-10-PCS") =>
    request<{ ok: true }>(`/encounters/${encounterId}/suggestions/reject`, {
      method: "POST",
      body: JSON.stringify({ code, codeSystem }),
    }),
};
