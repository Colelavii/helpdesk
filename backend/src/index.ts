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
import { registerEmailSendWorker } from "./tickets/email-queue.ts";

const app = express();
const port = Number(process.env.PORT) || 3001;

// Better Auth must be mounted before express.json(), or its client hangs.
app.all("/api/auth/*splat", toNodeHandler(auth));

// Also mounted ahead of express.json(), for a different reason: the inbound-email
// webhook needs a much larger body limit than the rest of the API (a Postmark
// payload carries the whole HTML part and its attachments), so that router parses
// its own bodies. Leaving it below this line would let the 100kb default 413 a
// student's email before the route ran.
app.use("/api/webhooks", webhooksRouter);

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/me", requireAuth, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

app.use("/api/users", usersRouter);
app.use("/api/tickets", ticketsRouter);

// The API serves regardless of the queue's health: the background jobs are an
// enhancement, and an inbound email is still stored (and answerable) without
// them. Failing to boot over it would take the whole helpdesk down with the AI.
try {
  await startQueue();
  await registerClassificationWorker();
  await registerAutoResolveWorker();
  await registerEmailSendWorker();
} catch (error) {
  console.error(
    "Job queue unavailable — inbound tickets will not be auto-classified or auto-resolved, and replies will not be emailed",
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
