import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";

// Who a request counts against. A visitor with a session is counted on their own, so people sharing one network (a
// dorm, an office, a phone carrier) do not eat each other's allowance. A request with no session can only be told
// apart by its address.
const sessionOrIp = (req: Request): string => (req.user ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip ?? "")}`);
const addressOnly = (req: Request): string => `ip:${ipKeyGenerator(req.ip ?? "")}`;

interface Options {
  windowMs: number;
  limit: number;
  // A ceiling for everyone behind one address together, several times the personal limit. It stops a script that keeps
  // dropping its cookie to look like new visitors, while leaving room for a whole network of ordinary people.
  addressLimit: number;
  message: { error: string };
  skip?: (req: Request) => boolean;
}

// Two limits in a row: a personal one (by session, or by address when there is none) and a shared one per address.
// Only the personal one sends the RateLimit headers, so a client sees its own remaining allowance.
export function createVisitorLimiter({ windowMs, limit, addressLimit, message, skip }: Options): RequestHandler {
  const personal = rateLimit({ windowMs, limit, keyGenerator: sessionOrIp, standardHeaders: "draft-7", legacyHeaders: false, message, skip });
  const address = rateLimit({ windowMs, limit: addressLimit, keyGenerator: addressOnly, standardHeaders: false, legacyHeaders: false, message, skip });
  return (req: Request, res: Response, next: NextFunction) => personal(req, res, (err?: unknown) => (err ? next(err) : address(req, res, next)));
}
