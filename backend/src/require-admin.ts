import type { NextFunction, Request, Response } from "express";

// Must run after requireAuth, which populates req.user. Authorization only —
// it assumes the session is already resolved and rejects non-admin roles.
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
