// What to do when Docker (SIGTERM) or Ctrl+C (SIGINT) asks the process to stop: finish the requests in flight,
// close the database cleanly, then exit 0. Without this Node ignores SIGTERM as PID 1 and Docker has to force-kill it.
export function createShutdown({ server, db, log = console.log, exit = process.exit, timeoutMs = 8000 }) {
  let shuttingDown = false;

  return function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);

    // If a connection never finishes, do not hang until Docker kills us (it waits 10 seconds by default).
    const timer = setTimeout(() => {
      log("Shutdown timed out, forcing exit");
      exit(1);
    }, timeoutMs);
    timer.unref();

    server.close((err) => {
      try {
        db.close();
      } catch (closeError) {
        log(`Could not close the database cleanly: ${closeError.message}`);
        err = err ?? closeError;
      }
      clearTimeout(timer);
      log("Shutdown complete");
      exit(err ? 1 : 0);
    });
  };
}
