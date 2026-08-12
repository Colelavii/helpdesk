import type { Response } from "express";

// Parse an integer route param (e.g. a numeric resource id). On a non-integer
// value, responds 404 with the given message (a bad id can't name a real
// resource) and returns null; otherwise returns the number. Mirrors parseBody's
// ergonomics, so a handler starts with
// `const id = parseId(req.params.id, res, "Ticket not found"); if (id === null) return;`.
export function parseId(
  value: string | undefined,
  res: Response,
  notFoundError = "Not found",
): number | null {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: notFoundError });
    return null;
  }
  return id;
}
