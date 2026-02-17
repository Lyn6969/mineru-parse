import type {
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  StreamCallbacks,
} from "./types";

const SSE_PARSE_ERROR_NAME = "SSEParseError";

export async function chatCompletion(
  config: AIConfig,
  messages: ChatMessage[],
  callbacks: StreamCallbacks,
): Promise<string> {
  try {
    const response = await requestChatCompletion(config, messages, true);

    if (!response.body) {
      const fallbackText = await chatCompletionNonStream(config, messages);
      callbacks.onComplete(fallbackText);
      return fallbackText;
    }

    try {
      const fullText = await parseSSEStream(response.body, callbacks);
      callbacks.onComplete(fullText);
      return fullText;
    } catch (error) {
      if (!isSSEParseError(error)) {
        throw error;
      }
      const fallbackText = await chatCompletionNonStream(config, messages);
      callbacks.onComplete(fallbackText);
      return fallbackText;
    }
  } catch (error) {
    const normalizedError = toError(error);
    notifyError(callbacks, normalizedError);
    throw normalizedError;
  }
}

export async function chatCompletionNonStream(
  config: AIConfig,
  messages: ChatMessage[],
): Promise<string> {
  const response = await requestChatCompletion(config, messages, false);
  let payload: ChatCompletionResponse;

  try {
    payload = (await response.json()) as unknown as ChatCompletionResponse;
  } catch {
    throw new Error("AI 服务返回格式错误");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("AI 服务返回格式错误");
  }
  return content;
}

async function requestChatCompletion(
  config: AIConfig,
  messages: ChatMessage[],
  stream: boolean,
): Promise<Response> {
  const url = buildChatCompletionsUrl(config.baseUrl);
  const body: ChatCompletionRequest = {
    model: config.model,
    messages,
    stream,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("无法连接到 AI 服务，请检查 API 地址");
  }

  if (!response.ok) {
    await throwStatusError(response);
  }

  return response;
}

async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks,
): Promise<string> {
  const reader = stream.getReader() as any;
  const decoder = new TextDecoder();
  let buffer = "";
  const state = {
    done: false,
    fullText: "",
  };

  try {
    while (!state.done) {
      let done: boolean | undefined = false;
      let value: Uint8Array | undefined;

      try {
        const result = await reader.read();
        done = result.done;
        value = result.value;
      } catch {
        throw createSSEParseError("SSE 流读取失败");
      }

      if (done) {
        buffer += decoder.decode();
        break;
      }

      if (!value) {
        continue;
      }

      buffer += decoder.decode(value, { stream: true });

      let lineEnd = buffer.indexOf("\n");
      while (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd).replace(/\r$/, "");
        buffer = buffer.slice(lineEnd + 1);

        processSSELine(line, state, callbacks);
        if (state.done) {
          break;
        }

        lineEnd = buffer.indexOf("\n");
      }
    }

    if (!state.done && buffer.trim()) {
      processSSELine(buffer.replace(/\r$/, ""), state, callbacks);
    }

    return state.fullText;
  } finally {
    reader.releaseLock();
  }
}

function processSSELine(
  rawLine: string,
  state: { done: boolean; fullText: string },
  callbacks: StreamCallbacks,
) {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) {
    return;
  }

  const data = line.slice(5).trim();
  if (!data) {
    return;
  }

  if (data === "[DONE]") {
    state.done = true;
    return;
  }

  let chunk: ChatCompletionChunk;
  try {
    chunk = JSON.parse(data) as ChatCompletionChunk;
  } catch {
    throw createSSEParseError("SSE 数据格式错误");
  }

  const token = chunk.choices?.[0]?.delta?.content;
  if (typeof token !== "string" || !token.length) {
    return;
  }

  state.fullText += token;
  callbacks.onToken(token);
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

async function throwStatusError(response: Response): Promise<never> {
  if (response.status === 401 || response.status === 403) {
    throw new Error("API 密钥无效或已过期");
  }

  if (response.status === 429) {
    throw new Error("请求频率过高，请稍后重试");
  }

  const errorBody = await readErrorBody(response);
  throw new Error(`AI 服务返回错误 (${response.status}): ${errorBody}`);
}

async function readErrorBody(response: Response): Promise<string> {
  const rawText = await response.text().catch(() => "");
  const text = rawText.trim();
  if (!text) {
    return "未知错误";
  }

  try {
    const payload = JSON.parse(text) as {
      error?: { message?: string };
      message?: string;
    };
    const message = payload.error?.message || payload.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // ignore non-JSON response body
  }

  return text;
}

function createSSEParseError(message: string): Error {
  const error = new Error(message);
  error.name = SSE_PARSE_ERROR_NAME;
  return error;
}

function isSSEParseError(error: unknown): boolean {
  return error instanceof Error && error.name === SSE_PARSE_ERROR_NAME;
}

function notifyError(callbacks: StreamCallbacks, error: Error) {
  try {
    callbacks.onError(error);
  } catch {
    // ignore callback errors and keep the original error
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}
