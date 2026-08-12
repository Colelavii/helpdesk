import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import CreateUserDialog from "@/components/CreateUserDialog";
import ErrorMessage from "@/components/ErrorMessage";
import UsersTable, { type UserRow } from "@/components/UsersTable";

async function fetchUsers(signal: AbortSignal): Promise<UserRow[]> {
  const { data } = await axios.get<{ users: UserRow[] }>("/api/users", {
    signal,
  });
  return data.users;
}

export default function UsersPage() {
  const {
    data: users,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["users"],
    queryFn: ({ signal }) => fetchUsers(signal),
  });

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Helpdesk staff with access to this workspace.
          </p>
        </div>
        <CreateUserDialog />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Team members</CardTitle>
          <CardDescription>
            Admins and agents provisioned for the helpdesk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <UsersTable isPending />
          ) : isError ? (
            <ErrorMessage>Unable to load users.</ErrorMessage>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <UsersTable users={users} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
