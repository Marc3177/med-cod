const API_BASE = "http://localhost:3000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Fired when a request comes back 401 — the auth context listens for this
 *  to clear the stored session, rather than every call site handling it. */
export const UNAUTHORIZED_EVENT = "med-cod:unauthorized";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("med-cod:token");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, JSON.stringify(body.message ?? body));
  }

  return res.json();
}
