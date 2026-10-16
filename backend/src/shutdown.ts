// Only what shutdown uses: the HTTP server's close (which calls back once requests in flight are done) and the
// database's close. Real servers and databases fit, and so do the small fakes in the tests.
export interface Closable {
  close(callback: (err?: Error) => void): unknown;
}

interface ShutdownOptions {
  server: Closable;
  db: { close(): unknown };
  log?: (message: string) => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
}

// What to do when Docker (SIGTERM) or Ctrl+C (SIGINT) asks the process to stop: finish the requests in flight,
// close the database cleanly, then exit 0. Without this Node ignores SIGTERM as PID 1 and Docker has to force-kill it.
export function createShutdown({ server, db, log = console.log, exit = process.exit, timeoutMs = 8000 }: ShutdownOptions) {
  let shuttingDown = false;

  return function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);

    // If a connection never finishes, do not hang until Docker kills us (it waits 10 seconds by default).
    const timer = setTimeout(() => {
      log("Shutdown timed out, forcing exit");
      exit(1);
    }, timeoutMs);
    timer.unref();

    server.close((err?: Error) => {
      try {
        db.close();
      } catch (closeError) {
        const error = closeError instanceof Error ? closeError : new Error(String(closeError));
        log(`Could not close the database cleanly: ${error.message}`);
        err = err ?? error;
      }
      clearTimeout(timer);
      log("Shutdown complete");
      exit(err ? 1 : 0);
    });
  };
}
