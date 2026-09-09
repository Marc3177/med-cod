import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { authApi } from "../api/auth.js";
import { UNAUTHORIZED_EVENT } from "../api/http.js";
import type { AuthUser } from "../api/types.js";

const TOKEN_KEY = "med-cod:token";
const USER_KEY = "med-cod:user";

type AuthContextValue = {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    return stored ? (JSON.parse(stored) as AuthUser) : null;
  });

  useEffect(() => {
    const onUnauthorized = () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  async function login(email: string, password: string) {
    const { accessToken, user: loggedInUser } = await authApi.login(email, password);
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(loggedInUser));
    setUser(loggedInUser);
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
