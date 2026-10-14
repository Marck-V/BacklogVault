import fs from "fs";
import path from "path";

const FILE = /^backlog-\d{8}-\d{6}\.db$/;

// Takes a consistent copy of the live database (safe while the site is running, unlike copying the file) and keeps the
// newest `keep` copies. Returns the path of the new backup.
export async function backupDatabase(db, directory, { keep = 14, now = new Date() } = {}) {
  fs.mkdirSync(directory, { recursive: true });

  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const target = path.join(directory, `backlog-${stamp}.db`);
  await db.backup(target);

  const old = fs
    .readdirSync(directory)
    .filter((name) => FILE.test(name))
    .sort()
    .reverse()
    .slice(Math.max(keep, 1));
  for (const name of old) fs.rmSync(path.join(directory, name), { force: true });

  return target;
}
