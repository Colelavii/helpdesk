import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import ErrorMessage from "@/components/ErrorMessage";
import { apiErrorMessage } from "@/lib/api-error";

interface DeletableUser {
  id: string;
  name: string;
}

export default function DeleteUserDialog({ user }: { user: DeletableUser }) {
  const [open, setOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => axios.delete(`/api/users/${user.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
    },
    onError: (error) => {
      setErrorMessage(
        apiErrorMessage(error, "Unable to delete the user. Please try again."),
      );
    },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setErrorMessage(null);
      mutation.reset();
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${user.name}`}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user</AlertDialogTitle>
          <AlertDialogDescription>
            This deactivates {user.name} and revokes their access. They will no
            longer appear in the list or be able to sign in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorMessage>{errorMessage}</ErrorMessage>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              // Keep the dialog open so the async mutation controls closing
              // (and can surface an error on failure).
              event.preventDefault();
              setErrorMessage(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
