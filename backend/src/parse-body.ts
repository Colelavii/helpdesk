import type { Response } from "express";
import { z } from "zod";

// Validate a request body against a Zod schema at a route boundary. On failure,
// responds 400 with the flattened Zod error and returns null; on success returns
// the parsed, typed data. Intended for object request bodies, so the ergonomic
// guard is `const data = parseBody(schema, req.body, res); if (!data) return;`.
export function parseBody<T extends z.ZodType>(
  schema: T,
  body: unknown,
  res: Response,
): z.infer<T> | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: z.flattenError(parsed.error) });
    return null;
  }
  return parsed.data;
}
