import { fail } from '../lib/rules.mjs';

const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) || [], c => parseInt(c, 16));
export const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const hash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
export function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = encoder.encode(a), right = encoder.encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left[i] || 0) ^ (right[i] || 0);
  return difference === 0;
}
const iterations = 100000;
async function derive(password, salt, rounds) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: rounds, hash: 'SHA-256' }, key, 256));
}
export async function passwordHash(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200 || password.trim().length < 12) fail('Password must be 12–200 characters.');
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256:${iterations}:${salt}:${await derive(password, salt, iterations)}`;
}
export async function passwordMatches(password, stored) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const [scheme, rounds, salt, expected] = (stored || '').split(':');
  if (scheme !== 'pbkdf2-sha256' || !/^\d+$/.test(rounds) || Number(rounds) < 100000 || Number(rounds) > 1000000 || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return equal(await derive(password, salt, Number(rounds)), expected);
}
export const dummyPassword = `pbkdf2-sha256:${iterations}:${'00'.repeat(16)}:${'00'.repeat(32)}`;
