export interface ChatCompletionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface SystemChatCompletionMessage {
  role: 'system';
  content: string;
}

export interface UserChatCompletionMessage {
  role: 'user';
  content: string;
}

export interface AssistantChatCompletionMessage {
  role: 'assistant';
  content?: string | null;
  tool_calls?: ChatCompletionToolCall[];
}

export interface ChatCompletionToolMessageParam {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

export type ChatCompletionMessageParam =
  | SystemChatCompletionMessage
  | UserChatCompletionMessage
  | AssistantChatCompletionMessage
  | ChatCompletionToolMessageParam;

export interface ChatCompletionResponse {
  choices: Array<{
    message: AssistantChatCompletionMessage;
  }>;
}

export interface ChatCompletionRequestPayload {
  messages: ChatCompletionMessageParam[];
  model: string;
  tools?: ChatCompletionTool[];
  tool_choice?: 'auto' | 'none';
  temperature?: number;
}
