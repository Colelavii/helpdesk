import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  createMessageSchema,
  type CreateMessageInput,
  type Ticket,
} from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ErrorMessage, { FieldError } from "@/components/ErrorMessage";
import { apiErrorMessage } from "@/lib/api-error";
import { ticketQueryKey } from "@/lib/query-keys";

// Takes the whole ticket (like MessageThread) rather than a bare id, so callers
// pass the object they already hold.
export default function ReplyForm({ ticket }: { ticket: Ticket }) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    getValues,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateMessageInput>({
    resolver: zodResolver(createMessageSchema),
    defaultValues: { body: "" },
  });

  const draft = watch("body");

  const mutation = useMutation({
    mutationFn: (values: CreateMessageInput) =>
      axios.post(`/api/tickets/${ticket.id}/messages`, values),
    onSuccess: () => {
      // Re-fetch the thread so the new outbound message appears.
      queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticket.id) });
      reset({ body: "" });
    },
    onError: (error) => {
      setError("root", {
        message: apiErrorMessage(
          error,
          "Unable to send your reply. Please try again.",
        ),
      });
    },
  });

  // Rewrites the draft in place. The agent stays the author — nothing is sent
  // until they read the result and hit "Send reply".
  const polish = useMutation({
    mutationFn: async (body: string) => {
      const { data } = await axios.post<{ body: string }>(
        `/api/tickets/${ticket.id}/polish`,
        { body },
      );
      return data.body;
    },
    onSuccess: (polished) => {
      clearErrors("root");
      setValue("body", polished, { shouldDirty: true, shouldValidate: true });
    },
    onError: (error) => {
      setError("root", {
        message: apiErrorMessage(
          error,
          "Unable to polish your reply. Please try again.",
        ),
      });
    },
  });

  const isPolishing = polish.isPending;
  // A blank draft disables both actions rather than surfacing a validation
  // error on submit — there is nothing to polish or send either way.
  const canSubmit = draft.trim().length > 0 && !isPolishing && !isSubmitting;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base font-medium">Reply</h2>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((values) => mutation.mutate(values))}
          noValidate
          className="space-y-3"
        >
          <Textarea
            aria-label="Reply message"
            rows={5}
            placeholder="Write a reply to the requester…"
            aria-invalid={!!errors.body}
            disabled={isPolishing}
            {...register("body")}
          />
          <FieldError>{errors.body?.message}</FieldError>
          <ErrorMessage>{errors.root?.message}</ErrorMessage>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canSubmit}
              onClick={() => polish.mutate(getValues("body"))}
            >
              {isPolishing ? "Polishing…" : "Polish"}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {isSubmitting ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
