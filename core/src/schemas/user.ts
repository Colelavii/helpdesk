import { z } from "zod";

// Shared by the API handler (server-side validation) and the create-user form
// (client-side validation) so both agree on the rules and messages.
export const createUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email address").trim(),
  password: z.string().trim().min(8, "Password must be at least 8 characters"),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

// Editing a user: name and email follow the same rules, but the password is
// optional — an empty value means "leave the current password unchanged", and a
// non-empty value must still satisfy the minimum length.
export const updateUserSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters"),
  email: z.email("Enter a valid email address").trim(),
  password: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || value.length >= 8,
      "Password must be at least 8 characters",
    ),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
