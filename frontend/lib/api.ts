export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const TOKEN_KEY = "class_test_portal_token";
const ROLE_KEY = "class_test_portal_role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function getRole(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ROLE_KEY);
}
export function setSession(token: string, role: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(ROLE_KEY, role);
}
export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ROLE_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && options.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the API. Check the backend URL and deployment status.", 0);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const unauthenticatedFlowPaths = ["/api/auth/student", "/api/auth/admin", "/api/auth/otp/verify", "/api/auth/otp/resend"];
    if (response.status === 401 && typeof window !== "undefined" && !unauthenticatedFlowPaths.includes(path)) {
      clearSession();
    }
    const detail = typeof body.detail === "string" ? body.detail : body.message || `Request failed (${response.status}).`;
    throw new ApiError(detail, response.status);
  }
  return body as T;
}
