import { firebaseConfig } from './firebase';
import { getFirebaseIdToken } from './firebaseIdToken';
import type { Group } from '../types/Group';
import type { Rule } from '../types/Rule';

interface UserSettingsPatch {
  rules?: Rule[];
  groups?: Group[];
  conversationHistory?: unknown[];
}

type FirestoreValue = Record<string, unknown>;
const SETTINGS_FIELDS = new Set(['rules', 'groups', 'conversationHistory']);

function encodeValue(value: unknown, ancestors = new Set<object>()): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error('Settings contain an invalid number.');
    }
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value !== 'object') throw new Error('Settings contain an unsupported value.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && Object.getPrototypeOf(prototype) !== null) {
    throw new Error('Settings must contain plain objects.');
  }
  if (ancestors.has(value)) throw new Error('Settings cannot contain circular references.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return { arrayValue: { values: Array.from(value, item => encodeValue(item, ancestors)) } };
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, encodeValue(item, ancestors)])),
      },
    };
  } finally {
    ancestors.delete(value);
  }
}

export async function saveUserSettings(userId: string, patch: UserSettingsPatch): Promise<void> {
  if (typeof userId !== 'string' || !userId || userId.length > 128
    || /[/\\]/u.test(userId) || [...userId].some(character => character.charCodeAt(0) < 32)) {
    throw new Error('A valid signed-in user is required to save settings.');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).some(key => !SETTINGS_FIELDS.has(key))) {
    throw new Error('Only rules, groups, and conversation history can be saved here.');
  }
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) throw new Error('No settings were supplied to save.');
  if (entries.some(([, value]) => !Array.isArray(value))) throw new Error('Settings fields must be arrays.');
  const fields = Object.fromEntries(entries.map(([key, value]) => [key, encodeValue(value)]));
  const mask = new URLSearchParams();
  for (const [key] of entries) mask.append('updateMask.fieldPaths', key);
  const token = await getFirebaseIdToken(userId);
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${encodeURIComponent(userId)}?${mask}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Could not save settings (${response.status}).`);
  }
}
