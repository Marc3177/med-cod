import { request } from "./http.js";
import type { Encounter, EncounterDetail } from "./types.js";

export const patientsApi = {
  workQueue: () => request<Encounter[]>("/work-queue"),
  encounter: (id: number) => request<EncounterDetail>(`/encounters/${id}`),
};
