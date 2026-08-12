import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createUserSchema, updateUserSchema } from "@helpdesk/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ErrorMessage, { FieldError } from "@/components/ErrorMessage";
import { apiErrorMessage } from "@/lib/api-error";

interface EditableUser {
  id: string;
  name: string;
  email: string;
}

type UserFormValues = {
  name: string;
  email: string;
  password: string;
};

type UserFormDialogProps =
  | { mode: "create"; user?: undefined }
  | { mode: "edit"; user: EditableUser };

export default function UserFormDialog(props: UserFormDialogProps) {
  const isEdit = props.mode === "edit";
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const buildDefaults = (): UserFormValues =>
    props.mode === "edit"
      ? { name: props.user.name, email: props.user.email, password: "" }
      : { name: "", email: "", password: "" };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(isEdit ? updateUserSchema : createUserSchema),
    defaultValues: buildDefaults(),
  });

  const mutation = useMutation({
    mutationFn: (values: UserFormValues) =>
      props.mode === "edit"
        ? axios.patch(`/api/users/${props.user.id}`, values)
        : axios.post("/api/users", values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      reset(buildDefaults());
    },
    onError: (error) => {
      setError("root", {
        message: apiErrorMessage(
          error,
          `Unable to ${isEdit ? "update" : "create"} the user. Please try again.`,
        ),
      });
    },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Repopulate from the latest props (and clear stale errors) on every open.
    reset(buildDefaults());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {isEdit ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${props.user.name}`}
          >
            <PencilIcon />
          </Button>
        ) : (
          <Button>New user</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit user" : "Create user"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this staff member's details."
              : "Provision a new helpdesk staff member. They'll be added as an agent."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...register("name")}
            />
            <FieldError>{errors.name?.message}</FieldError>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FieldError>{errors.email?.message}</FieldError>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password ? (
              <FieldError>{errors.password.message}</FieldError>
            ) : (
              isEdit && (
                <p className="text-sm text-muted-foreground">
                  Leave blank to keep the current password.
                </p>
              )
            )}
          </div>

          <ErrorMessage>{errors.root?.message}</ErrorMessage>

          <DialogFooter>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? isEdit
                  ? "Saving…"
                  : "Creating…"
                : isEdit
                  ? "Save changes"
                  : "Create user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
