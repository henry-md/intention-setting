#!/usr/bin/env node

import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import { ensureAdmin, resolveUserId } from './clear-usage-history.mjs';

const __filename = fileURLToPath(import.meta.url);

function printHelp() {
  console.log(`
Usage:
  npm run truncate:usage-site-totals -- --email <email>
  npm run truncate:usage-site-totals -- --user <uid>

This script scans users/{userId}.dailyUsageHistory and only changes days where
the sum of siteTotals is greater than totalTimeSpent. It prints every planned
day change and asks you to type APPLY before writing anything.
`);
}

function parseArgs(argv) {
  const args = { user: '', email: '', help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

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

function seconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function formatTime(totalSeconds) {
  const safeSeconds = seconds(totalSeconds);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function normalizeSiteTotals(rawSiteTotals) {
  if (!rawSiteTotals || typeof rawSiteTotals !== 'object' || Array.isArray(rawSiteTotals)) {
    return {};
  }

  const siteTotals = {};
  for (const [siteKey, rawSeconds] of Object.entries(rawSiteTotals)) {
    const key = String(siteKey).trim();
    const siteSeconds = seconds(rawSeconds);
    if (!key || siteSeconds <= 0) continue;
    siteTotals[key] = (siteTotals[key] || 0) + siteSeconds;
  }

  return siteTotals;
}

function sumSiteTotals(siteTotals) {
  return Object.values(siteTotals).reduce((sum, value) => sum + seconds(value), 0);
}

function orderSiteKeysForOverflowRemoval(siteTotals) {
  return Object.entries(siteTotals)
    .sort(([siteA, secondsA], [siteB, secondsB]) => {
      const diff = seconds(secondsB) - seconds(secondsA);
      return diff !== 0 ? diff : siteA.localeCompare(siteB);
    })
    .map(([siteKey]) => siteKey);
}

function truncateSiteTotals(siteTotals, targetTotal) {
  const adjusted = { ...siteTotals };
  let overflow = Math.max(0, sumSiteTotals(siteTotals) - targetTotal);

  for (const siteKey of orderSiteKeysForOverflowRemoval(siteTotals)) {
    if (overflow <= 0) break;

    const current = seconds(adjusted[siteKey]);
    const reduction = Math.min(current, overflow);
    const next = current - reduction;
    overflow -= reduction;

    if (next > 0) {
      adjusted[siteKey] = next;
    } else {
      delete adjusted[siteKey];
    }
  }

  return Object.fromEntries(
    Object.entries(adjusted)
      .filter(([, value]) => seconds(value) > 0)
      .sort(([siteA, secondsA], [siteB, secondsB]) => {
        const diff = seconds(secondsB) - seconds(secondsA);
        return diff !== 0 ? diff : siteA.localeCompare(siteB);
      })
  );
}

function buildDayPlan(dayKey, entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const totalTimeSpent = seconds(entry.totalTimeSpent);
  const originalSiteTotals = normalizeSiteTotals(entry.siteTotals);
  const originalSiteSum = sumSiteTotals(originalSiteTotals);

  if (originalSiteSum <= totalTimeSpent) {
    return null;
  }

  const nextSiteTotals = truncateSiteTotals(originalSiteTotals, totalTimeSpent);
  const nextSiteSum = sumSiteTotals(nextSiteTotals);
  const siteKeys = Array.from(
    new Set([...Object.keys(originalSiteTotals), ...Object.keys(nextSiteTotals)])
  ).sort((siteA, siteB) => {
    const diff = seconds(originalSiteTotals[siteB]) - seconds(originalSiteTotals[siteA]);
    return diff !== 0 ? diff : siteA.localeCompare(siteB);
  });
  const siteChanges = siteKeys
    .map((siteKey) => {
      const before = seconds(originalSiteTotals[siteKey]);
      const after = seconds(nextSiteTotals[siteKey]);
      return { siteKey, before, after };
    })
    .filter((change) => change.before !== change.after);

  return {
    dayKey,
    totalTimeSpent,
    originalSiteSum,
    nextSiteSum,
    removedSeconds: originalSiteSum - nextSiteSum,
    siteChanges,
    nextEntry: {
      ...entry,
      totalTimeSpent,
      trackedSiteCount: Object.keys(nextSiteTotals).length,
      siteTotals: nextSiteTotals,
    },
  };
}

function buildCleanupPlan(dailyUsageHistory) {
  if (!dailyUsageHistory || typeof dailyUsageHistory !== 'object' || Array.isArray(dailyUsageHistory)) {
    return { plans: [], scannedDays: 0, underreportedDays: 0 };
  }

  const plans = [];
  let underreportedDays = 0;

  for (const [dayKey, entry] of Object.entries(dailyUsageHistory).sort(([dayA], [dayB]) =>
    dayA.localeCompare(dayB)
  )) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;

    const totalTimeSpent = seconds(entry.totalTimeSpent);
    const siteSum = sumSiteTotals(normalizeSiteTotals(entry.siteTotals));
    if (siteSum > 0 && siteSum < totalTimeSpent) {
      underreportedDays += 1;
    }

    const dayPlan = buildDayPlan(dayKey, entry);
    if (!dayPlan) continue;

    plans.push(dayPlan);
  }

  return {
    plans,
    scannedDays: Object.keys(dailyUsageHistory).length,
    underreportedDays,
  };
}

function printPlanSummary({ userId, email, plans, scannedDays, underreportedDays }) {
  const totalRemoved = plans.reduce((sum, plan) => sum + plan.removedSeconds, 0);

  console.log('');
  console.log('Usage history siteTotals cleanup plan');
  console.log(`User: ${userId}${email ? ` (${email})` : ''}`);
  console.log(`Scanned days: ${scannedDays}`);
  console.log(`Days to change: ${plans.length}`);
  console.log(`Site-specific time to remove: ${formatTime(totalRemoved)}`);
  if (underreportedDays > 0) {
    console.log(`Days left alone where siteTotals sum is below totalTimeSpent: ${underreportedDays}`);
  }
  console.log('');

  for (const plan of plans) {
    console.log(
      `${plan.dayKey}: siteTotals ${formatTime(plan.originalSiteSum)} -> ${formatTime(plan.nextSiteSum)}; totalTimeSpent stays ${formatTime(plan.totalTimeSpent)}`
    );
    console.log(`  Under dailyUsageHistory["${plan.dayKey}"].siteTotals:`);

    for (const change of plan.siteChanges) {
      const afterLabel = change.after > 0 ? formatTime(change.after) : 'removed';
      console.log(`    ["${change.siteKey}"]: ${formatTime(change.before)} -> ${afterLabel}`);
    }
  }

  console.log('');
}

async function confirmApply(userId, plans) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `Type APPLY to update users/${userId}.dailyUsageHistory for ${plans.length} day(s): `
    );
    return answer.trim() === 'APPLY';
  } finally {
    rl.close();
  }
}

export async function truncateUsageHistorySiteTotalsForUser(userId, email = '') {
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new Error(`User doc not found: users/${userId}`);
  }

  const data = snap.data() || {};
  const dailyUsageHistory = data.dailyUsageHistory || {};
  const cleanupPlan = buildCleanupPlan(dailyUsageHistory);

  printPlanSummary({
    userId,
    email,
    plans: cleanupPlan.plans,
    scannedDays: cleanupPlan.scannedDays,
    underreportedDays: cleanupPlan.underreportedDays,
  });

  if (cleanupPlan.plans.length === 0) {
    console.log('No changes needed.');
    return { changedDays: 0, applied: false };
  }

  const shouldApply = await confirmApply(userId, cleanupPlan.plans);
  if (!shouldApply) {
    console.log('Cancelled. No changes written.');
    return { changedDays: cleanupPlan.plans.length, applied: false };
  }

  const updateArgs = cleanupPlan.plans.flatMap((plan) => [
    new FieldPath('dailyUsageHistory', plan.dayKey),
    plan.nextEntry,
  ]);
  updateArgs.push('usageHistorySiteTotalsTruncatedAt', Date.now());

  await userRef.update(...updateArgs);

  console.log(`Applied changes for ${cleanupPlan.plans.length} day(s).`);
  return { changedDays: cleanupPlan.plans.length, applied: true };
}

async function main() {
  const { user, email, help } = parseArgs(process.argv.slice(2));

  if (help) {
    printHelp();
    return;
  }

  if (!user && !email) {
    printHelp();
    throw new Error('Missing user selector. Pass --user <uid> or --email <email>.');
  }

  ensureAdmin();
  const userId = await resolveUserId(user, email);
  await truncateUsageHistorySiteTotalsForUser(userId, email);
}

if (path.resolve(process.argv[1] || '') === __filename) {
  main().catch((error) => {
    console.error('Truncate failed:', error.message || error);
    process.exit(1);
  });
}
