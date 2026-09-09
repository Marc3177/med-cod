import { request } from "./http.js";

export type ChartChange =
  | { type: "NEW_DOCUMENT"; documentId: number; documentType: string; createdAt: string }
  | { type: "CODING_UPDATED"; action: string; byUserId: number; createdAt: string }
  | { type: "QUERY_RESPONDED"; queryId: number; respondedAt: string }
  | { type: "QA_RETURNED"; qaReviewId: number; reason: string | null; reviewedAt: string };

export type ChartChangeSummary = {
  isFirstView: boolean;
  changes: ChartChange[];
};

export const chartChangesApi = {
  getChanges: (encounterId: number) => request<ChartChangeSummary>(`/encounters/${encounterId}/chart-changes`),
  acknowledge: (encounterId: number) =>
    request<{ ok: true }>(`/encounters/${encounterId}/chart-changes/ack`, { method: "POST" }),
};
