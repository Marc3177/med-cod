import { request } from "./http.js";

export type DecisionExplanation = {
  code: string;
  codeSystem: "ICD-10-CM" | "ICD-10-PCS";
  description: string;
  isBillable: boolean;
  checks: {
    specific: boolean;
    ccMcc: "MCC" | "CC" | null;
  };
  evidence: {
    excerpt: string;
    matchedVia: string;
    documentId: number;
    documentType: string;
  }[];
  relatedQueries: {
    id: number;
    question: string;
    status: string;
  }[];
};

export const decisionExplanationApi = {
  explain: (encounterId: number, code: string, codeSystem: "ICD-10-CM" | "ICD-10-PCS") =>
    request<DecisionExplanation>(
      `/encounters/${encounterId}/decision-explanation?code=${encodeURIComponent(code)}&codeSystem=${encodeURIComponent(codeSystem)}`
    ),
};
