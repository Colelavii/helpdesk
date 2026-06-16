import express, { type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.ts";
import { requireAuth } from "./require-auth.ts";

const app = express();
const port = Number(process.env.PORT) || 3001;

// Better Auth must be mounted before express.json(), or its client hangs.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
