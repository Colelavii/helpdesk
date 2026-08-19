import { PgBoss } from "pg-boss";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// pg-boss installs and owns its own tables. Keeping them in a dedicated schema
// rather than `public` keeps them out of Prisma's way entirely: migrations never
// see tables they don't know about, and `prisma db pull` won't drag the job
// tables into schema.prisma. Creating the schema needs DDL rights on first boot.
export const boss = new PgBoss({
  connectionString,
  schema: "pgboss",
  // Its own small pool, separate from Prisma's — polling one low-volume queue
  // doesn't need more, and request traffic never contends with it.
  max: 2,
});

// Failures that belong to no single job (a dropped connection, a maintenance
// error) arrive here. An unhandled "error" event on an EventEmitter is fatal to
// the process, so this listener is not optional.
boss.on("error", (error) => {
  console.error("pg-boss error", error);
});

export async function startQueue(): Promise<void> {
  await boss.start();
}

// Graceful by default: in-flight jobs are given time to finish rather than being
// killed mid-model-call and retried.
export async function stopQueue(): Promise<void> {
  await boss.stop({ graceful: true, timeout: 30_000 });
}
