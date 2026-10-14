import path from "path";
import db from "../src/db.js";
import { backupDatabase } from "../src/backupDatabase.js";

// Usage: npm run backup            (in Docker: docker compose exec api npm run backup)
// Writes a dated copy of the database next to it, in a "backups" folder, and keeps the newest 14.
// The copy lives on the same disk, so also copy the folder somewhere else (another machine or cloud storage).
const dbPath = process.env.DB_PATH || "";
const directory = process.env.BACKUP_DIR || path.join(dbPath ? path.dirname(dbPath) : ".", "backups");
const keep = Number(process.env.BACKUP_KEEP ?? 14);

const file = await backupDatabase(db, directory, { keep });
console.log(`Backup written to ${file} (keeping the newest ${keep}).`);
db.close();
