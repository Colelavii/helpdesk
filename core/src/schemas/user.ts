import { z } from "zod";

// Shared by the API handler (server-side validation) and the create-user form
// (client-side validation) so both agree on the rules and messages.
export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email address").trim(),
  password: z.string().trim().min(8, "Password must be at least 8 characters"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
