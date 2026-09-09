import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.js";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("coder1@med-cod.test");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError("Invalid email or password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-57px)] flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-brand-50 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white text-lg font-bold shadow-card mb-3">
            M
          </span>
          <h1 className="text-lg font-semibold text-slate-900">Sign in to Med-Cod</h1>
          <p className="text-xs text-slate-500 mt-1">Inpatient coding workspace</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white rounded-xl shadow-card border border-slate-200 p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
            <input
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-shadow"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
            <input
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 transition-shadow"
              type="password"
              placeholder="coder123"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-brand-600 hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium py-2 shadow-sm transition-colors"
          >
            {loading ? "Signing in..." : "Log in"}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-4">Seeded coder: coder1@med-cod.test</p>
      </div>
    </div>
  );
}
