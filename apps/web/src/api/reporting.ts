import { request } from "./http.js";

export type ReportingSummary = {
  firstPassAcceptanceRate: number | null;
  finalizedEncounterCount: number;
  qa: {
    totalReviews: number;
    approved: number;
    returned: number;
    pending: number;
    returnRate: number | null;
  };
  queries: {
    total: number;
    byStatus: Record<string, number>;
    avgTurnaroundHours: number | null;
  };
  coderProductivity: { userId: number; email: string; finalizedCount: number }[];
  specificityCaptureRate: number | null;
  workloadByStatus: Record<string, number>;
};

export const reportingApi = {
  summary: () => request<ReportingSummary>("/reports/summary"),
};
