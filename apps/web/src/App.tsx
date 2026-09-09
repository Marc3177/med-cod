import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";
import { Login } from "./pages/Login.js";
import { WorkQueue } from "./pages/WorkQueue.js";
import { EncounterDetail } from "./pages/EncounterDetail.js";
import { ProviderQueue } from "./pages/ProviderQueue.js";
import { AuditorQueue } from "./pages/AuditorQueue.js";
import { Reports } from "./pages/Reports.js";

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white px-6 py-3 flex justify-between items-center shadow-sm">
      <div className="flex items-center gap-5">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white text-sm font-bold shadow-sm group-hover:bg-brand-700 transition-colors">
            M
          </span>
          <span className="text-md font-semibold text-slate-900 tracking-tight">Med-Cod</span>
        </Link>
        {user?.role === "PROVIDER" && (
          <Link to="/provider" className="text-xs text-slate-500 hover:text-brand-700">
            Pending Queries
          </Link>
        )}
        {user?.role === "AUDITOR" && (
          <Link to="/audit" className="text-xs text-slate-500 hover:text-brand-700">
            QA Queue
          </Link>
        )}
        {(user?.role === "SUPERVISOR" || user?.role === "ADMIN") && (
          <Link to="/reports" className="text-xs text-slate-500 hover:text-brand-700">
            Reports
          </Link>
        )}
      </div>
      {user && (
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {user.email}
            <span className="text-slate-300">·</span>
            <span className="font-medium text-slate-600">{user.role}</span>
          </span>
          <button
            className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
            onClick={logout}
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-slate-50">
          <Header />
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<WorkQueue />} />
              <Route path="/encounters/:id" element={<EncounterDetail />} />
              <Route path="/provider" element={<ProviderQueue />} />
              <Route path="/audit" element={<AuditorQueue />} />
              <Route path="/reports" element={<Reports />} />
            </Route>
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
