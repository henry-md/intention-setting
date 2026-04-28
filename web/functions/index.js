const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

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
