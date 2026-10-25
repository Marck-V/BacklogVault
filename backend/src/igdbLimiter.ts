import { createVisitorLimiter } from "./visitorLimits.ts";

// Cap on routes that spend IGDB quota, so one visitor or bot cannot use up the budget everyone shares. It counts each
// visitor with a session on their own; everyone behind one address also shares a larger ceiling (see visitorLimits.ts).
export function createIgdbLimiter(
  limit = Number(process.env.IGDB_ROUTE_RATE_LIMIT ?? 60),
  addressLimit = Number(process.env.IGDB_ADDRESS_RATE_LIMIT ?? limit * 5)
) {
  return createVisitorLimiter({
    windowMs: 60 * 1000,
    limit,
    addressLimit,
    message: { error: "Too many requests. Please slow down and try again in a minute." },
  });
}
