import { request } from "./http.js";
import type { CodingDecision } from "./types.js";

export const codingApi = {
  saveDraft: (encounterId: number, decision: unknown) =>
    request<CodingDecision>(`/encounters/${encounterId}/coding`, {
      method: "PUT",
      body: JSON.stringify({ decision }),
    }),
  finalize: (encounterId: number) =>
    request<CodingDecision>(`/encounters/${encounterId}/coding/finalize`, {
      method: "POST",
    }),
};
