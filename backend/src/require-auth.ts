import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./auth.ts";

type Session = typeof auth.$Infer.Session;

// Make the resolved user/session available on the Express request after requireAuth runs.
declare global {
  namespace Express {
    interface Request {
      user?: Session["user"];
      session?: Session["session"];
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = result.user;
    req.session = result.session;
    next();
  } catch (err) {
    next(err);
  }
}
