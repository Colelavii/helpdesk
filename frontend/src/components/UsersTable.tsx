import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Role } from "@helpdesk/core";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import UserFormDialog from "@/components/UserFormDialog";
import DeleteUserDialog from "@/components/DeleteUserDialog";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
  // The AI agent tickets are assigned to during auto-resolution. Flagged by the
  // server rather than inferred here, so its email stays a backend concern.
  isAiAgent: boolean;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const SKELETON_ROWS = 5;

export default function UsersTable({
  users,
  isPending = false,
}: {
  users?: UserRow[];
  isPending?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="w-0">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell>
                  <Skeleton className="size-8" />
                </TableCell>
              </TableRow>
            ))
          : users?.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {user.name}
                    {/* "Automated" rather than "AI": the account is already
                        named AI, and this line's job is to say it isn't a
                        person — which is why the row has no controls. */}
                    {user.isAiAgent && (
                      <Badge variant="secondary">Automated</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {user.email}
                </TableCell>
                <TableCell className="capitalize">{user.role}</TableCell>
                <TableCell className="text-muted-foreground">
                  {dateFormatter.format(new Date(user.createdAt))}
                </TableCell>
                <TableCell className="text-right">
                  {/* The AI agent is listed so admins know it exists, but it has
                      no password to change and deleting it would break
                      auto-resolve assignment — both routes reject it anyway. */}
                  {!user.isAiAgent && (
                    <div className="flex justify-end gap-1">
                      <UserFormDialog mode="edit" user={user} />
                      {user.role !== Role.admin && (
                        <DeleteUserDialog user={user} />
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
