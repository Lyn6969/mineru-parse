import type {
  AIConfig,
  ChatMessage,
  ChatCompletionRequest,
  StreamCallbacks,
} from "./types";

const SSE_PARSE_ERROR_NAME = "SSEParseError";
type AIErrorKind =
  | "incomplete_response"
  | "invalid_response"
  | "provider_error";
type AIRequestDeadlineKind = "timeout" | "cancelled";

class AIResponseError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AIResponseError";
  }
}

class AIRequestDeadlineError extends Error {
  constructor(
    readonly reason: AIRequestDeadlineKind,
    message: string,
  ) {
    super(message);
    this.name = "AIRequestDeadlineError";
  }
}

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
      const fullText = await parseSSEStream(
        response.body,
        callbacks,
        config.timeoutMs ?? 120_000,
        config.signal,
      );
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
  let payload: unknown;

  try {
    payload = await withBodyDeadline(
      response.json(),
      config.timeoutMs ?? 120_000,
      config.signal,
    );
  } catch (error) {
    if (error instanceof AIRequestDeadlineError) {
      throw error;
    }
    throw new AIResponseError("invalid_response", "AI 服务返回格式错误");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("choices" in payload) ||
    !Array.isArray(payload.choices)
  ) {
    throw new AIResponseError("invalid_response", "AI 服务返回格式错误");
  }
  const choice = payload.choices[0];
  if (typeof choice !== "object" || choice === null) {
    throw new AIResponseError("invalid_response", "AI 服务返回格式错误");
  }

  assertCompleteFinishReason(
    "finish_reason" in choice ? choice.finish_reason : undefined,
  );
  const message = "message" in choice ? choice.message : undefined;
  if (
    typeof message !== "object" ||
    message === null ||
    !("content" in message) ||
    typeof message.content !== "string"
  ) {
    throw new AIResponseError("invalid_response", "AI 服务返回格式错误");
  }
  return message.content;
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

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (config.signal) {
    if (config.signal.aborted) {
      controller.abort();
    } else {
      config.signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? 120_000,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error("AI request timed out or was cancelled");
    }
    throw new Error("无法连接到 AI 服务，请检查 API 地址");
  } finally {
    clearTimeout(timer);
    config.signal?.removeEventListener("abort", abortFromCaller);
  }

  if (!response.ok) {
    await throwStatusError(response);
  }

  return response;
}

type SSEState = {
  done: boolean;
  sawDoneMarker: boolean;
  finishedNormally: boolean;
  fullText: string;
};

async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: StreamCallbacks,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  // No options means a default reader, not the BYOB reader in Zotero's union type.
  const reader = stream.getReader() as ReadableStreamDefaultReader;
  const decoder = new TextDecoder();
  let buffer = "";
  const state: SSEState = {
    done: false,
    sawDoneMarker: false,
    finishedNormally: false,
    fullText: "",
  };

  try {
    while (!state.done) {
      let done: boolean | undefined = false;
      let value: Uint8Array | undefined;

      try {
        const result = await withBodyDeadline(reader.read(), timeoutMs, signal);
        done = result.done;
        value = result.value;
      } catch (error) {
        if (error instanceof AIRequestDeadlineError) {
          void reader.cancel(error.message);
          throw error;
        }
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

    if (!state.sawDoneMarker && !state.finishedNormally) {
      throw new AIResponseError("incomplete_response", "AI 响应未完成");
    }
    return state.fullText;
  } finally {
    reader.releaseLock();
  }
}

function processSSELine(
  rawLine: string,
  state: SSEState,
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
    state.sawDoneMarker = true;
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw createSSEParseError("SSE 数据格式错误");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw createSSEParseError("SSE 数据格式错误");
  }

  const providerError = getProviderErrorMessage(parsed);
  if (providerError) {
    throw new AIResponseError("provider_error", providerError);
  }

  const choices = "choices" in parsed ? parsed.choices : undefined;
  if (!Array.isArray(choices) || choices.length === 0) {
    return;
  }
  const choice = choices[0];
  if (typeof choice !== "object" || choice === null) {
    throw createSSEParseError("SSE 数据格式错误");
  }

  assertCompleteFinishReason(
    "finish_reason" in choice ? choice.finish_reason : undefined,
    state,
  );

  const delta = "delta" in choice ? choice.delta : undefined;
  if (typeof delta !== "object" || delta === null) {
    return;
  }
  const token = "content" in delta ? delta.content : undefined;
  if (typeof token !== "string" || !token.length) {
    return;
  }

  state.fullText += token;
  callbacks.onToken(token);
}

function assertCompleteFinishReason(reason: unknown, state?: SSEState): void {
  if (typeof reason !== "string") {
    return;
  }
  if (reason !== "stop") {
    throw new AIResponseError(
      "incomplete_response",
      `AI 响应未完成（${reason}）`,
    );
  }
  if (state) {
    state.finishedNormally = true;
  }
}

function getProviderErrorMessage(payload: object): string {
  if (!("error" in payload)) {
    return "";
  }
  const error = payload.error;
  if (typeof error !== "object" || error === null) {
    return "AI 服务返回错误";
  }
  const message = "message" in error ? error.message : undefined;
  return typeof message === "string" && message.trim()
    ? message
    : "AI 服务返回错误";
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
    const payload: unknown = JSON.parse(text);
    if (typeof payload === "object" && payload !== null) {
      let message: unknown;
      if (
        "error" in payload &&
        typeof payload.error === "object" &&
        payload.error !== null &&
        "message" in payload.error
      ) {
        message = payload.error.message;
      } else if ("message" in payload) {
        message = payload.message;
      }
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
  } catch {
    // ignore non-JSON response body
  }

  return text;
}

async function withBodyDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  let clearAbortListener: (() => void) | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new AIRequestDeadlineError(
            "timeout",
            "AI request timed out or was cancelled",
          ),
        ),
      timeoutMs,
    );
  });
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
          reject(
            new AIRequestDeadlineError("cancelled", "AI request was cancelled"),
          );
          return;
        }
        const onAbort = () =>
          reject(
            new AIRequestDeadlineError("cancelled", "AI request was cancelled"),
          );
        signal.addEventListener("abort", onAbort, { once: true });
        clearAbortListener = () => signal.removeEventListener("abort", onAbort);
      })
    : null;

  try {
    return await Promise.race(
      abortPromise
        ? [operation, deadline, abortPromise]
        : [operation, deadline],
    );
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    clearAbortListener?.();
  }
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
