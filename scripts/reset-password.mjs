import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { passwordHash, email } from '../lib/store.mjs';

function hiddenPrompt(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run recovery in an interactive terminal. Passwords are never accepted in command arguments.');
  return new Promise((resolvePrompt, reject) => {
    let value = '';
    process.stdout.write(label);
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const done = () => { process.stdin.off('data', read); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    function read(chunk) {
      for (const char of chunk) {
        if (char === '\u0003') { done(); reject(new Error('Recovery cancelled.')); return; }
        if (char === '\r' || char === '\n') { done(); resolvePrompt(value); return; }
        if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); continue; }
        if (char >= ' ' && value.length < 201) value += char;
      }
    }
    process.stdin.on('data', read);
  });
}
let db;
try {
  const address = email(process.argv[2]);
  const filename = join(resolve(process.env.DATA_DIR || './data'), 'leads.sqlite');
  if (!existsSync(filename)) throw new Error('Database not found. Run from the dashboard directory and check DATA_DIR.');
  db = new DatabaseSync(filename);
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(address);
  if (!user) throw new Error('No account has this email address.');
  const first = await hiddenPrompt('New password (input hidden): ');
  const second = await hiddenPrompt('Confirm password (input hidden): ');
  if (first !== second) throw new Error('Passwords did not match. No change was made.');
  const password = passwordHash(first);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(password, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO audit(actor_id,action,target_id,details,created_at) VALUES(?,?,?,?,?)').run(user.id, 'password.operator_recovery', user.id, 'Offline recovery by the server operator.', new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  console.log('Password reset. All sessions for this account have been revoked.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db?.close(); }
