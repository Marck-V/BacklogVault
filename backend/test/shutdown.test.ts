import { describe, it, expect, vi, afterEach } from "vitest";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createShutdown } from "../src/shutdown.ts";

afterEach(() => {
  vi.useRealTimers();
});

function fakes({ closeError, dbCloseThrows }: { closeError?: Error; dbCloseThrows?: boolean } = {}) {
  const events: string[] = [];
  const server: { close: (callback: (err?: Error) => void) => void; finish: () => void } = {
    finish: () => {},
    close: vi.fn((callback: (err?: Error) => void) => {
      events.push("server.close");
      // Real servers call back once in-flight requests have finished.
      server.finish = () => callback(closeError);
    }),
  };
  const db = {
    close: vi.fn(() => {
      events.push("db.close");
      if (dbCloseThrows) throw new Error("db busy");
    }),
  };
  const exit = vi.fn((code: number) => {
    events.push(`exit(${code})`);
  });
  const log = vi.fn();
  return { server, db, exit, log, events };
}

describe("createShutdown", () => {
  it("stops accepting connections, then closes the database, then exits 0", () => {
    const { server, db, exit, log, events } = fakes();
    createShutdown({ server, db, exit, log })("SIGTERM");

    expect(events).toEqual(["server.close"]); // the database stays open while requests are still in flight
    server.finish();
    expect(events).toEqual(["server.close", "db.close", "exit(0)"]);
    expect(log).toHaveBeenCalledWith("SIGTERM received, shutting down");
  });

  it("ignores a second signal while already shutting down", () => {
    const { server, db, exit, log } = fakes();
    const shutdown = createShutdown({ server, db, exit, log });
    shutdown("SIGTERM");
    shutdown("SIGINT");
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("exits 1 when closing the server reports an error", () => {
    const { server, db, exit, log } = fakes({ closeError: new Error("boom") });
    createShutdown({ server, db, exit, log })("SIGTERM");
    server.finish();
    expect(db.close).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still exits, with code 1, if the database cannot be closed", () => {
    const { server, db, exit, log } = fakes({ dbCloseThrows: true });
    createShutdown({ server, db, exit, log })("SIGTERM");
    server.finish();
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db busy"));
  });

  it("forces an exit if a connection never finishes", () => {
    vi.useFakeTimers();
    const { server, db, exit, log } = fakes();
    createShutdown({ server, db, exit, log, timeoutMs: 8000 })("SIGTERM");

    vi.advanceTimersByTime(7999);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(log).toHaveBeenCalledWith("Shutdown timed out, forcing exit");
  });

  it("does not force an exit after a clean shutdown", () => {
    vi.useFakeTimers();
    const { server, db, exit, log } = fakes();
    createShutdown({ server, db, exit, log, timeoutMs: 8000 })("SIGTERM");
    server.finish();
    vi.advanceTimersByTime(20000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

// Windows cannot deliver SIGTERM to a child process the way Linux and Docker do, so this runs on Linux and in CI.
describe.skipIf(process.platform === "win32")("the real server process", () => {
  it("exits 0 and logs a clean shutdown when sent SIGTERM", async () => {
    const serverFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "server.js");
    const child = spawn(process.execPath, [serverFile], {
      env: { ...process.env, PORT: "0", DB_PATH: ":memory:" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    await vi.waitFor(() => expect(output).toMatch(/Backend listening/), { timeout: 5000, interval: 50 });

    const started = Date.now();
    child.kill("SIGTERM");
    const code = await new Promise((resolve) => child.on("exit", resolve));

    expect(code).toBe(0);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(output).toMatch(/SIGTERM received, shutting down/);
    expect(output).toMatch(/Shutdown complete/);
  });
});
