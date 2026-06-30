import { Navigate, Outlet } from "react-router-dom";
import { Role } from "@helpdesk/core";
import { useSession } from "../lib/auth-client";

export default function AdminRoute() {
  const { data: session, isPending } = useSession();

  if (isPending) return null;

  if (session?.user.role !== Role.admin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
