import {
  type ChatCompletionRequestPayload,
  type ChatCompletionResponse,
} from '../types/openaiChat';
import { firebaseConfig } from './firebase';
import { getFirebaseIdToken } from './firebaseIdToken';

const OPENAI_PROXY_REGION = 'us-central1';

function getOpenAIProxyUrl(): string {
  return `https://${OPENAI_PROXY_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/openaiChatCompletion`;
}

export async function createOpenAIChatCompletion(
  userId: string,
  payload: ChatCompletionRequestPayload
): Promise<ChatCompletionResponse> {
  const idToken = await getFirebaseIdToken(userId);

  const response = await fetch(getOpenAIProxyUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null) as
    | ChatCompletionResponse
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication expired. Please sign out and sign back in.');
    }

    if (response.status === 503) {
      throw new Error('OpenAI proxy is not configured yet. Set the OPENAI_API_KEY Firebase secret and redeploy.');
    }

    const errorMessage = data && 'error' in data ? data.error?.message : null;
    throw new Error(errorMessage || `OpenAI proxy request failed (${response.status})`);
  }

  if (!data || !('choices' in data)) {
    throw new Error('OpenAI proxy returned an unexpected response.');
  }

  return data;
}
