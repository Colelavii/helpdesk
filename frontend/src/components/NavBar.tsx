import { Link, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";
import { Button } from "@/components/ui/button";

export default function NavBar() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <nav className="flex items-center justify-between border-b bg-background px-6 py-3">
      <div className="flex gap-4">
        <Link
          to="/"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Home
        </Link>
        <Link
          to="/tickets"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Tickets
        </Link>
        {session?.user.role === "admin" && (
          <Link
            to="/users"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Users
          </Link>
        )}
      </div>
      {session && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {session.user.name}
          </span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      )}
    </nav>
  );
}
