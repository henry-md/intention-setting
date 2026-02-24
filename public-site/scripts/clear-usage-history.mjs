#!/usr/bin/env node

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

/*
ex. usage:
GOOGLE_APPLICATION_CREDENTIALS="/Users/Henry/Developer/intention-setting/public-site/scripts/intention-setter-firebase-adminsdk-fbsvc-0449a100a5.json" npm run clear:usage-history -- --email hdeutsch13@gmail.com
*/

function parseArgs(argv) {
  const args = { user: '', email: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--user' || token === '-u') {
      args.user = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--email' || token === '-e') {
      args.email = argv[i + 1] || '';
      i += 1;
      continue;
    }
  }
  return args;
}

async function resolveUserId(user, email) {
  if (user) return user;
  if (!email) {
    throw new Error('Missing user selector. Pass --user <uid> or --email <email>');
  }

  const auth = getAuth();
  const record = await auth.getUserByEmail(email);
  return record.uid;
}

function ensureAdmin() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error(
      'GOOGLE_APPLICATION_CREDENTIALS is required. Point it to a Firebase service-account JSON file.'
    );
  }

  if (getApps().length === 0) {
    initializeApp({ credential: applicationDefault() });
  }
}

async function main() {
  const { user, email } = parseArgs(process.argv.slice(2));

  ensureAdmin();
  const userId = await resolveUserId(user, email);
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new Error(`User doc not found: users/${userId}`);
  }

  const usageResetRequestedAt = Date.now();
  const payload = {
    dailyUsageHistory: FieldValue.delete(),
    timeTracking: FieldValue.delete(),
    usageResetRequestedAt
  };

  await userRef.set(payload, { merge: true });

  console.log(`Cleared all usage history (including current day) for users/${userId}.`);
  console.log(`Requested extension local usage reset via usageResetRequestedAt=${usageResetRequestedAt}.`);
  if (email) {
    console.log(`Resolved email ${email} -> ${userId}`);
  }
}

main().catch((error) => {
  console.error('Clear failed:', error.message || error);
  process.exit(1);
});
