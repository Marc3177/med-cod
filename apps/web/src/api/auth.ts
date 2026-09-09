import { request } from "./http.js";
import type { AuthUser } from "./types.js";

export const authApi = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: AuthUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
