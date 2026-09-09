import { request } from "./http.js";

export type CodingQuery = {
  id: number;
  encounterId: number;
  createdById: number;
  question: string;
  clinicalIndicators: string | null;
  relatedCode: string | null;
  relatedCodeSystem: string | null;
  status: "DRAFT" | "SENT" | "RESPONDED" | "RESOLVED" | "EXPIRED";
  sentAt: string | null;
  response: string | null;
  respondedAt: string | null;
  respondedById: number | null;
  resolvedAt: string | null;
  resolvedById: number | null;
  createdAt: string;
};

export type PendingProviderQuery = CodingQuery & {
  encounter: { id: number; patient: { mrn: string } };
};

export const queriesApi = {
  listForEncounter: (encounterId: number) => request<CodingQuery[]>(`/encounters/${encounterId}/queries`),
  create: (
    encounterId: number,
    question: string,
    clinicalIndicators?: string,
    relatedCode?: string,
    relatedCodeSystem?: string
  ) =>
    request<CodingQuery>(`/encounters/${encounterId}/queries`, {
      method: "POST",
      body: JSON.stringify({ question, clinicalIndicators, relatedCode, relatedCodeSystem }),
    }),
  send: (queryId: number) => request<CodingQuery>(`/queries/${queryId}/send`, { method: "POST" }),
  resolve: (queryId: number) => request<CodingQuery>(`/queries/${queryId}/resolve`, { method: "POST" }),

  provider: {
    listPending: () => request<PendingProviderQuery[]>("/provider/queries"),
    respond: (queryId: number, response: string) =>
      request<CodingQuery>(`/provider/queries/${queryId}/respond`, {
        method: "POST",
        body: JSON.stringify({ response }),
      }),
  },
};
