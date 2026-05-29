import express, { type Request, type Response } from "express";

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(express.json());

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/hello", (_req: Request, res: Response) => {
  res.json({ message: "Hello from the helpdesk backend" });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
