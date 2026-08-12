// The ticket detail query is keyed while only the route param is known, so its
// id is a string. Anything invalidating that query from a loaded ticket holds a
// numeric id instead — going through here keeps the two spellings from drifting
// apart, which would silently stop the thread from re-fetching.
export const ticketQueryKey = (id: string | number) =>
  ["ticket", String(id)] as const;
