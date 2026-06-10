import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import NavBar from "./components/NavBar";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminRoute from "./components/AdminRoute";
import HomePage from "./pages/HomePage";
import TicketsPage from "./pages/TicketsPage";
import UsersPage from "./pages/UsersPage";
import LoginPage from "./pages/LoginPage";
import { useSession } from "./lib/auth-client";

function AppLayout() {
  return (
    <div className="min-h-screen bg-muted">
      <NavBar />
      <main className="px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

function LoginRoute() {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (session) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
