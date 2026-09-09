import { request } from "./http.js";
import type { Icd10CmResult, Icd10PcsResult } from "./types.js";

export const encoderApi = {
  searchIcd10Cm: (q: string) => request<Icd10CmResult[]>(`/encoder/icd-10-cm?q=${encodeURIComponent(q)}`),
  searchIcd10Pcs: (q: string) => request<Icd10PcsResult[]>(`/encoder/icd-10-pcs?q=${encodeURIComponent(q)}`),
};
