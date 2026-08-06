import Database from 'better-sqlite3';
import * as argon2 from 'argon2';

export async function seedAdminUser(db: Database.Database): Promise<void> {
  const existing = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (existing.count > 0) return;

  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error(
      'ADMIN_PASSWORD environment variable is required for first-time setup.\n' +
        'Set it before starting the server, e.g.: ADMIN_PASSWORD=yourpassword'
    );
  }

  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)').run('admin', hash);
}
