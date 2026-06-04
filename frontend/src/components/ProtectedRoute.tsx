import { Navigate, Outlet } from "react-router-dom";
import { useSession } from "../lib/auth-client";

export default function ProtectedRoute() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />; // if user selects the back button they don't end up in a loop
  }

  return <Outlet />;
}
