export type AIConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  [key: string]: unknown;
};

export type ChatCompletionResponse = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    finish_reason?: string | null;
    message: {
      role: "system" | "user" | "assistant" | string;
      content: string;
    };
  }>;
};

export type ChatCompletionChunk = {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    finish_reason?: string | null;
    delta: {
      role?: "system" | "user" | "assistant" | string;
      content?: string;
    };
  }>;
};

export type StreamCallbacks = {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
};
