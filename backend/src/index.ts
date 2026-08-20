import express, { type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.ts";
import { requireAuth } from "./require-auth.ts";
import { usersRouter } from "./routes/users.ts";
import { ticketsRouter } from "./routes/tickets.ts";
import { webhooksRouter } from "./routes/webhooks.ts";
import { startQueue, stopQueue } from "./queue.ts";
import { registerClassificationWorker } from "./tickets/classification-queue.ts";
import { registerAutoResolveWorker } from "./tickets/auto-resolve-queue.ts";

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

app.use("/api/users", usersRouter);
app.use("/api/tickets", ticketsRouter);
app.use("/api/webhooks", webhooksRouter);

// The API serves regardless of the queue's health: the background jobs are an
// enhancement, and an inbound email is still stored (and answerable) without
// them. Failing to boot over it would take the whole helpdesk down with the AI.
try {
  await startQueue();
  await registerClassificationWorker();
  await registerAutoResolveWorker();
} catch (error) {
  console.error(
    "Job queue unavailable — inbound tickets will not be auto-classified or auto-resolved",
    error,
  );
}

const server = app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

// Stop taking new work, let an in-flight job finish, then exit.
async function shutdown(): Promise<void> {
  server.close();
  await stopQueue();
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown().catch((error: unknown) => {
      console.error("Failed to shut down cleanly", error);
      process.exit(1);
    });
  });
}
