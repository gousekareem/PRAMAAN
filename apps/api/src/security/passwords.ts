import { hash, verify, Algorithm } from '@node-rs/argon2';

// Argon2id parameters (OWASP 2024 guidance: m=19 MiB, t=2, p=1 minimum).
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/** Used to equalize timing when the account does not exist. */
export const DUMMY_HASH_PROMISE = hashPassword('pramaan-dummy-password-for-timing');

export function passwordPolicyIssues(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 12) issues.push('at least 12 characters');
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) issues.push('upper and lower case letters');
  if (!/[0-9]/.test(pw)) issues.push('a digit');
  return issues;
}
