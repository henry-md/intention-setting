const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const Stripe = require('stripe');

if (!admin.apps.length) {
  admin.initializeApp();
}

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const STRIPE_API_KEY = defineSecret('firestore-stripe-payments-STRIPE_API_KEY-3ltd');

function getBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }

  return authHeader.slice('Bearer '.length).trim() || null;
}

function sanitizePayload(body) {
  if (!body || typeof body !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }

  const {
    messages,
    tools,
    tool_choice,
    temperature,
    model,
  } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array.');
  }

  if (messages.length > 100) {
    throw new Error('messages may not exceed 100 items.');
  }

  if (tools !== undefined && !Array.isArray(tools)) {
    throw new Error('tools must be an array when provided.');
  }

  if (
    tool_choice !== undefined &&
    tool_choice !== 'auto' &&
    tool_choice !== 'none'
  ) {
    throw new Error('tool_choice must be "auto" or "none" when provided.');
  }

  if (
    temperature !== undefined &&
    (typeof temperature !== 'number' || Number.isNaN(temperature))
  ) {
    throw new Error('temperature must be a number when provided.');
  }

  if (model !== undefined && typeof model !== 'string') {
    throw new Error('model must be a string when provided.');
  }

  return {
    model: model || 'gpt-4',
    messages,
    tools,
    tool_choice,
    temperature,
  };
}

const CANCELLABLE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
]);

function normalizeStripeTimestamp(value) {
  return typeof value === 'number' ? value : undefined;
}

function getSubscriptionCurrentPeriodEnd(subscription) {
  return (
    normalizeStripeTimestamp(subscription.current_period_end) ||
    normalizeStripeTimestamp(subscription.items?.data?.[0]?.current_period_end)
  );
}

function normalizeFirestoreTimestamp(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value?.seconds === 'number') {
    return value.seconds;
  }

  if (typeof value?._seconds === 'number') {
    return value._seconds;
  }

  return undefined;
}

function normalizeSubscription(subscription) {
  return {
    id: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
  };
}

function normalizeSubscriptionDoc(subscriptionDoc) {
  const data = subscriptionDoc.data() || {};
  return {
    id: subscriptionDoc.id,
    status: typeof data.status === 'string' ? data.status : undefined,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    currentPeriodEnd: normalizeFirestoreTimestamp(data.current_period_end),
  };
}

function formatHttpError(error, fallbackMessage) {
  return {
    message: error instanceof Error ? error.message : fallbackMessage,
  };
}

async function verifyFirebaseRequest(req, logPrefix) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      error: { status: 401, message: 'Missing Firebase auth token.' },
    };
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    if (!decodedToken?.uid) {
      return {
        error: { status: 401, message: 'Authenticated user uid is missing.' },
      };
    }

    return { uid: decodedToken.uid };
  } catch (error) {
    console.error(`${logPrefix} Invalid Firebase auth token:`, error);
    return {
      error: { status: 401, message: 'Invalid Firebase auth token.' },
    };
  }
}

async function findUserSubscriptionDoc(uid, subscriptionId) {
  const subscriptionsRef = admin
    .firestore()
    .collection('customers')
    .doc(uid)
    .collection('subscriptions');

  if (subscriptionId) {
    const requestedDoc = await subscriptionsRef.doc(subscriptionId).get();
    return requestedDoc.exists ? requestedDoc : null;
  }

  const snapshot = await subscriptionsRef.get();
  return snapshot.docs
    .filter((docSnapshot) => {
      const status = docSnapshot.get('status');
      return typeof status === 'string' && CANCELLABLE_SUBSCRIPTION_STATUSES.has(status);
    })
    .sort((a, b) => {
      const aPeriodEnd = normalizeFirestoreTimestamp(a.get('current_period_end')) || 0;
      const bPeriodEnd = normalizeFirestoreTimestamp(b.get('current_period_end')) || 0;
      return bPeriodEnd - aPeriodEnd;
    })[0] || null;
}

function createHttpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function setSubscriptionCancelAtPeriodEnd({
  uid,
  subscriptionId,
  cancelAtPeriodEnd,
  stripeSecretKey,
  logPrefix,
}) {
  const subscriptionDoc = await findUserSubscriptionDoc(uid, subscriptionId);

  if (!subscriptionDoc) {
    throw createHttpError(404, 'No active subscription found.');
  }

  const subscriptionData = subscriptionDoc.data() || {};
  const storedStatus = subscriptionData.status;
  if (
    typeof storedStatus === 'string' &&
    !CANCELLABLE_SUBSCRIPTION_STATUSES.has(storedStatus)
  ) {
    throw createHttpError(409, 'This subscription is not currently active.');
  }

  const stripe = new Stripe(stripeSecretKey);
  const existingSubscription = await stripe.subscriptions.retrieve(subscriptionDoc.id);

  if (
    typeof subscriptionData.customer === 'string' &&
    typeof existingSubscription.customer === 'string' &&
    subscriptionData.customer !== existingSubscription.customer
  ) {
    console.error(`${logPrefix} Subscription customer mismatch:`, {
      uid,
      subscriptionId: subscriptionDoc.id,
    });
    throw createHttpError(403, 'Subscription does not belong to this user.');
  }

  if (!CANCELLABLE_SUBSCRIPTION_STATUSES.has(existingSubscription.status)) {
    throw createHttpError(409, 'This subscription is not currently active.');
  }

  const updatedSubscription =
    existingSubscription.cancel_at_period_end === cancelAtPeriodEnd
      ? existingSubscription
      : await stripe.subscriptions.update(subscriptionDoc.id, {
          cancel_at_period_end: cancelAtPeriodEnd,
        });

  const subscriptionUpdate = {
    status: updatedSubscription.status,
    cancel_at_period_end: Boolean(updatedSubscription.cancel_at_period_end),
    cancel_at: normalizeStripeTimestamp(updatedSubscription.cancel_at) || null,
    canceled_at: normalizeStripeTimestamp(updatedSubscription.canceled_at) || null,
  };
  const currentPeriodEnd = getSubscriptionCurrentPeriodEnd(updatedSubscription);
  if (currentPeriodEnd) {
    subscriptionUpdate.current_period_end = currentPeriodEnd;
  }

  await subscriptionDoc.ref.set(subscriptionUpdate, { merge: true });

  return normalizeSubscription(updatedSubscription);
}

exports.openaiChatCompletion = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 120,
    secrets: [OPENAI_API_KEY],
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed.' } });
      return;
    }

    const token = getBearerToken(req);

    if (!token) {
      res.status(401).json({ error: { message: 'Missing Firebase auth token.' } });
      return;
    }

    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(token);
    } catch (error) {
      console.error('[openaiChatCompletion] Invalid Firebase auth token:', error);
      res.status(401).json({ error: { message: 'Invalid Firebase auth token.' } });
      return;
    }

    if (!decodedToken?.uid) {
      res.status(401).json({ error: { message: 'Authenticated user uid is missing.' } });
      return;
    }

    let payload;
    try {
      payload = sanitizePayload(req.body);
    } catch (error) {
      res.status(400).json({
        error: {
          message: error instanceof Error ? error.message : 'Invalid request payload.',
        },
      });
      return;
    }

    const apiKey = OPENAI_API_KEY.value();
    if (!apiKey) {
      res.status(503).json({
        error: {
          message: 'OPENAI_API_KEY secret is not configured for Firebase Functions.',
        },
      });
      return;
    }

    try {
      const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const responseJson = await openAIResponse.json();

      if (!openAIResponse.ok) {
        console.error('[openaiChatCompletion] OpenAI request failed:', {
          status: openAIResponse.status,
          uid: decodedToken.uid,
          error: responseJson,
        });
        res.status(openAIResponse.status).json(responseJson);
        return;
      }

      res.status(200).json(responseJson);
    } catch (error) {
      console.error('[openaiChatCompletion] Unexpected error:', {
        uid: decodedToken.uid,
        error,
      });
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : 'Unexpected proxy error.',
        },
      });
    }
  }
);

exports.getStripeSubscription = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed.' } });
      return;
    }

    const authResult = await verifyFirebaseRequest(req, '[getStripeSubscription]');
    if (authResult.error) {
      res.status(authResult.error.status).json({
        error: { message: authResult.error.message },
      });
      return;
    }

    try {
      const subscriptionDoc = await findUserSubscriptionDoc(authResult.uid, '');

      res.status(200).json({
        subscription: subscriptionDoc ? normalizeSubscriptionDoc(subscriptionDoc) : null,
      });
    } catch (error) {
      console.error('[getStripeSubscription] Unexpected error:', {
        uid: authResult.uid,
        error,
      });
      res.status(500).json({
        error: formatHttpError(error, 'Could not load subscription.'),
      });
    }
  }
);

exports.cancelStripeSubscription = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 30,
    secrets: [STRIPE_API_KEY],
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed.' } });
      return;
    }

    const authResult = await verifyFirebaseRequest(req, '[cancelStripeSubscription]');
    if (authResult.error) {
      res.status(authResult.error.status).json({
        error: { message: authResult.error.message },
      });
      return;
    }

    const uid = authResult.uid;
    const subscriptionId =
      req.body && typeof req.body.subscriptionId === 'string'
        ? req.body.subscriptionId.trim()
        : '';

    const stripeSecretKey = STRIPE_API_KEY.value();
    if (!stripeSecretKey) {
      res.status(503).json({
        error: {
          message: 'Stripe API key secret is not configured for Firebase Functions.',
        },
      });
      return;
    }

    try {
      const subscription = await setSubscriptionCancelAtPeriodEnd({
        uid,
        subscriptionId,
        cancelAtPeriodEnd: true,
        stripeSecretKey,
        logPrefix: '[cancelStripeSubscription]',
      });

      res.status(200).json({ subscription });
    } catch (error) {
      console.error('[cancelStripeSubscription] Unexpected error:', {
        uid,
        subscriptionId: subscriptionId || null,
        error,
      });

      const statusCode =
        typeof error?.statusCode === 'number' && error.statusCode >= 400
          ? error.statusCode
          : 500;

      res.status(statusCode).json({
        error: formatHttpError(error, 'Could not cancel subscription.'),
      });
    }
  }
);

exports.resumeStripeSubscription = onRequest(
  {
    cors: true,
    region: 'us-central1',
    timeoutSeconds: 30,
    secrets: [STRIPE_API_KEY],
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed.' } });
      return;
    }

    const authResult = await verifyFirebaseRequest(req, '[resumeStripeSubscription]');
    if (authResult.error) {
      res.status(authResult.error.status).json({
        error: { message: authResult.error.message },
      });
      return;
    }

    const uid = authResult.uid;
    const subscriptionId =
      req.body && typeof req.body.subscriptionId === 'string'
        ? req.body.subscriptionId.trim()
        : '';

    const stripeSecretKey = STRIPE_API_KEY.value();
    if (!stripeSecretKey) {
      res.status(503).json({
        error: {
          message: 'Stripe API key secret is not configured for Firebase Functions.',
        },
      });
      return;
    }

    try {
      const subscription = await setSubscriptionCancelAtPeriodEnd({
        uid,
        subscriptionId,
        cancelAtPeriodEnd: false,
        stripeSecretKey,
        logPrefix: '[resumeStripeSubscription]',
      });

      res.status(200).json({ subscription });
    } catch (error) {
      console.error('[resumeStripeSubscription] Unexpected error:', {
        uid,
        subscriptionId: subscriptionId || null,
        error,
      });

      const statusCode =
        typeof error?.statusCode === 'number' && error.statusCode >= 400
          ? error.statusCode
          : 500;

      res.status(statusCode).json({
        error: formatHttpError(error, 'Could not resume subscription.'),
      });
    }
  }
);
