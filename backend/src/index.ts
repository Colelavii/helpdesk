import express, { type Request, type Response } from "express";
import { prisma } from "./prisma.ts";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/hello", (_req: Request, res: Response) => {
  res.json({ message: "Hello from the helpdesk backend" });
});

app.get("/api/db-check", async (_req: Request, res: Response) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ status: "ok", userCount });
  } catch (err) {
    res.status(500).json({
      status: "error",
      message: err instanceof Error ? err.message : "unknown error",
    });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
