import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { createMessageSchema, type CreateMessageInput } from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ErrorMessage, { FieldError } from "@/components/ErrorMessage";
import { apiErrorMessage } from "@/lib/api-error";
import { ticketQueryKey } from "@/lib/query-keys";

// Takes the whole ticket (like MessageThread) rather than a bare id, so callers
// pass the object they already hold.
export default function ReplyForm({ ticket }: { ticket: { id: number } }) {
  const queryClient = useQueryClient();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateMessageInput>({
    resolver: zodResolver(createMessageSchema),
    defaultValues: { body: "" },
  });

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
            {...register("body")}
          />
          <FieldError>{errors.body?.message}</FieldError>
          <ErrorMessage>{errors.root?.message}</ErrorMessage>
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
