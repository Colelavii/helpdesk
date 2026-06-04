import { Link, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";

export default function NavBar() {
  const navigate = useNavigate();
  const { data: session } = useSession();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <nav className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex gap-4">
        <Link to="/" className="text-sm font-medium text-gray-700 hover:text-blue-600">
          Home
        </Link>
        <Link to="/tickets" className="text-sm font-medium text-gray-700 hover:text-blue-600">
          Tickets
        </Link>
      </div>
      {session && (
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{session.user.name}</span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      )}
    </nav>
  );
}
