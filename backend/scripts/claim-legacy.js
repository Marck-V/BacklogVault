import db from "../src/db.js";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run claim-legacy -- you@example.com");
  process.exit(1);
}

const user = db.prepare("SELECT id FROM users WHERE email = ? AND is_guest = 0").get(email);
if (!user) {
  console.error(`No registered account for ${email}. Create the account in the app first.`);
  process.exit(1);
}

const { changes } = db.prepare("UPDATE lists SET user_id = ? WHERE user_id IS NULL").run(user.id);
console.log(`Assigned ${changes} pre-accounts list(s) to ${email}`);
