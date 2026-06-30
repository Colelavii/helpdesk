// The two user roles. String values match the Prisma `Role` enum and the
// values stored in the database / returned by the API, so this can be used
// interchangeably with the raw role strings — but always prefer the enum.
export enum Role {
  admin = "admin",
  agent = "agent",
}
