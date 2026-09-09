import { request } from "./http.js";

export type QaReview = {
  id: number;
  encounterId: number;
  status: "PENDING" | "APPROVED" | "RETURNED";
  reason: string | null;
  reviewedById: number | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type PendingQaReview = QaReview & {
  encounter: {
    id: number;
    patient: { mrn: string };
    codingDecision: { diagnoses: unknown; msDrg: string | null; msDrgDescription: string | null } | null;
  };
};

export const qaApi = {
  listForEncounter: (encounterId: number) => request<QaReview[]>(`/encounters/${encounterId}/qa-reviews`),

  auditor: {
    listPending: () => request<PendingQaReview[]>("/audit/queue"),
    approve: (reviewId: number) => request<QaReview>(`/audit/reviews/${reviewId}/approve`, { method: "POST" }),
    returnToCoder: (reviewId: number, reason: string) =>
      request<QaReview>(`/audit/reviews/${reviewId}/return`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
  },
};
