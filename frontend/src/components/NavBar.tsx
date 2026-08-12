import { useNavigate } from "react-router-dom";
import { Role } from "@helpdesk/core";
import { signOut, useSession } from "../lib/auth-client";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/ui/link";

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
        <TextLink to="/" variant="nav">
          Home
        </TextLink>
        <TextLink to="/tickets" variant="nav">
          Tickets
        </TextLink>
        {session?.user.role === Role.admin && (
          <TextLink to="/users" target="_blank" variant="nav">
            Users
          </TextLink>
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
