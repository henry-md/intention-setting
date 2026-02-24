#!/usr/bin/env node

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

/*
ex. usage:
GOOGLE_APPLICATION_CREDENTIALS="/Users/Henry/Developer/intention-setting/public-site/scripts/intention-setter-firebase-adminsdk-fbsvc-0449a100a5.json" npm run seed:usage-history -- --email hdeutsch13@gmail.com --days 120
*/

const SOCIAL_SITES = [
  'youtube.com',
  'reddit.com',
  'snapchat.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'facebook.com',
  'netflix.com',
];

const TARGET_MEAN_MINUTES = 45;
const TARGET_STDDEV_MINUTES = 20;
const SEASONAL_AMPLITUDE_MINUTES = 8; // slight seasonal wave
const SEASONAL_WAVELENGTH_DAYS = 365; // ~12 months

function parseArgs(argv) {
  const args = { user: '', email: '', days: 90 };
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
    if (token === '--days' || token === '-d') {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.days = Math.floor(parsed);
      }
      i += 1;
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

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomNormal() {
  // Box-Muller transform
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function sampleGamma(shape, scale) {
  // Marsaglia and Tsang method for shape >= 1
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = randomNormal();
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = Math.random();
    if (u < 1 - 0.0331 * Math.pow(x, 4)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function generateDailyMinutes(dayIndex) {
  // Seasonal mean with 12-month wavelength.
  const seasonalMean =
    TARGET_MEAN_MINUTES +
    (SEASONAL_AMPLITUDE_MINUTES * Math.sin((2 * Math.PI * dayIndex) / SEASONAL_WAVELENGTH_DAYS));

  // Keep non-negative values with a gamma distribution while targeting the requested stddev.
  // For Gamma(k, theta): mean = k*theta, stddev = sqrt(k)*theta.
  const safeMean = Math.max(5, seasonalMean);
  const shape = Math.max(1.01, Math.pow(safeMean / TARGET_STDDEV_MINUTES, 2));
  const scale = Math.pow(TARGET_STDDEV_MINUTES, 2) / safeMean;
  const sampled = sampleGamma(shape, scale);

  // Clamp extreme outliers so chart remains realistic.
  return Math.max(1, Math.min(180, sampled));
}

function pickRandomSites() {
  const shuffled = [...SOCIAL_SITES].sort(() => Math.random() - 0.5);
  const count = randInt(3, 6);
  return shuffled.slice(0, count);
}

function normalizeSiteKey(site) {
  try {
    const url = new URL(site.startsWith('http') ? site : `https://${site}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return String(site).replace(/^www\./, '');
  }
}

function buildSiteTotals(sites, totalSeconds) {
  if (sites.length === 0 || totalSeconds <= 0) return {};

  const weights = sites.map(() => Math.random() + 0.2);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const totals = {};

  let allocated = 0;
  sites.forEach((site, index) => {
    const remainingSites = sites.length - index;
    if (remainingSites === 1) {
      totals[site] = Math.max(totalSeconds - allocated, 0);
      allocated += totals[site];
      return;
    }
    const seconds = Math.max(0, Math.round((weights[index] / totalWeight) * totalSeconds));
    totals[site] = seconds;
    allocated += seconds;
  });

  if (allocated !== totalSeconds) {
    const firstSite = sites[0];
    totals[firstSite] = Math.max((totals[firstSite] || 0) + (totalSeconds - allocated), 0);
  }

  return totals;
}

function normalizeSiteTotals(siteTotals) {
  const normalized = {};

  Object.entries(siteTotals || {}).forEach(([rawSiteKey, rawSeconds]) => {
    const siteKey = normalizeSiteKey(rawSiteKey);
    const seconds = Math.max(0, Math.floor(Number(rawSeconds) || 0));
    if (!siteKey || seconds <= 0) return;
    normalized[siteKey] = (normalized[siteKey] || 0) + seconds;
  });

  return normalized;
}

function createDailyUsageHistoryEntry(siteTotals, periodStart, periodEnd, capturedAt) {
  const normalizedSiteTotals = normalizeSiteTotals(siteTotals);
  const totalTimeSpent = Object.values(normalizedSiteTotals).reduce((sum, value) => sum + value, 0);

  return {
    totalTimeSpent,
    trackedSiteCount: Object.keys(normalizedSiteTotals).length,
    siteTotals: normalizedSiteTotals,
    periodStart,
    periodEnd,
    capturedAt,
  };
}

function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const { user, email, days } = parseArgs(process.argv.slice(2));

  ensureAdmin();
  const userId = await resolveUserId(user, email);
  const db = getFirestore();
  const userRef = db.collection('users').doc(userId);
  const snap = await userRef.get();

  if (!snap.exists) {
    throw new Error(`User doc not found: users/${userId}`);
  }

  const now = Date.now();
  const dailyUsageHistory = {};

  // Seed historical days only (exclude current day to preserve real-time usage today).
  for (let offset = days; offset >= 1; offset -= 1) {
    const dayIndex = days - 1 - offset;
    const date = new Date(now - (offset * 24 * 60 * 60 * 1000));
    const start = new Date(date);
    start.setHours(4, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const minutes = generateDailyMinutes(dayIndex);
    const totalSeconds = Math.round(minutes * 60);
    const sites = pickRandomSites();
    const rawSiteTotals = buildSiteTotals(sites, totalSeconds);
    dailyUsageHistory[dayKey(date)] = createDailyUsageHistoryEntry(
      rawSiteTotals,
      start.getTime(),
      end.getTime(),
      end.getTime()
    );
  }

  const data = snap.data() || {};
  const existingRules = Array.isArray(data.rules) ? data.rules : [];
  const shouldSeedRules = existingRules.length === 0;
  const seededRules = shouldSeedRules
    ? [
        {
          id: 'seed-social-rule',
          name: 'Seed Social Media',
          type: 'hard',
          timeLimit: 120,
          targets: SOCIAL_SITES.map((site) => ({ type: 'url', id: site })),
          createdAt: new Date().toISOString(),
        },
      ]
    : existingRules;

  await userRef.set(
    {
      rules: seededRules,
      dailyUsageHistory,
    },
    { merge: true }
  );

  console.log(
    `Seeded ${Object.keys(dailyUsageHistory).length} historical days for users/${userId} (current day untouched).`
  );
  if (email) {
    console.log(`Resolved email ${email} -> ${userId}`);
  }
  if (shouldSeedRules) {
    console.log('User had no rules; added a default seeded rule for common social sites.');
  }
}

main().catch((error) => {
  console.error('Seed failed:', error.message || error);
  process.exit(1);
});
