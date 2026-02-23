#!/usr/bin/env node

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function parseArgs(argv) {
  const args = { user: '', email: '', clearTimeTracking: false };
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
    if (token === '--with-time-tracking') {
      args.clearTimeTracking = true;
    }
  }
  return args;
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const { user, email, clearTimeTracking } = parseArgs(process.argv.slice(2));

  ensureAdmin();
  const userId = await resolveUserId(user, email);
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new Error(`User doc not found: users/${userId}`);
  }

  const data = snap.data() || {};
  const dailyUsageHistory = data.dailyUsageHistory && typeof data.dailyUsageHistory === 'object'
    ? data.dailyUsageHistory
    : {};
  const todayKey = dayKey(new Date());
  const preservedTodayEntry = dailyUsageHistory[todayKey];
  const payload = preservedTodayEntry
    ? { dailyUsageHistory: { [todayKey]: preservedTodayEntry } }
    : { dailyUsageHistory: FieldValue.delete() };

  await userRef.set(payload, { merge: true });

  console.log(
    preservedTodayEntry
      ? `Cleared historical dailyUsageHistory for users/${userId}, preserved today (${todayKey}).`
      : `Cleared dailyUsageHistory for users/${userId}.`
  );
  if (clearTimeTracking) {
    console.log('--with-time-tracking was ignored to preserve current-day usage.');
  }
  if (email) {
    console.log(`Resolved email ${email} -> ${userId}`);
  }
}

main().catch((error) => {
  console.error('Clear failed:', error.message || error);
  process.exit(1);
});
