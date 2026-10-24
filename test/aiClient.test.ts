import { assert } from "chai";
import {
  chatCompletion,
  chatCompletionNonStream,
} from "../src/modules/ai/apiClient";
import type { AIConfig, StreamCallbacks } from "../src/modules/ai/types";

const config: AIConfig = {
  baseUrl: "https://example.test/v1",
  apiKey: "test-key",
  model: "test-model",
  systemPrompt: "",
};

const callbacks: StreamCallbacks = {
  onToken: () => {},
  onComplete: () => {},
  onError: () => {},
};

const originalFetch = globalThis.fetch;

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function sseResponse(chunks: string[]): Response {
  return new Response(streamFromText(chunks.join("")), { status: 200 });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function chunk(content: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    choices: [
      {
        delta: content ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  })}\n\n`;
}

async function expectRejection(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch {
    return;
  }
  assert.fail("Expected the AI response to be rejected");
}

describe("AI completion integrity", function () {
  afterEach(function () {
    globalThis.fetch = originalFetch;
  });

  it("accepts a complete streamed response", async function () {
    globalThis.fetch = async () =>
      sseResponse([chunk("hello"), chunk("", "stop"), "data: [DONE]\n\n"]);
    const result = await chatCompletion(config, [], callbacks);
    assert.equal(result, "hello");
  });

  it("aborts a stalled request after the configured timeout", async function () {
    globalThis.fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
    await expectRejection(
      chatCompletion({ ...config, timeoutMs: 10 }, [], callbacks),
    );
  });

  it("aborts a stalled streaming body after the configured timeout", async function () {
    globalThis.fetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
      });
    await expectRejection(
      chatCompletion({ ...config, timeoutMs: 10 }, [], callbacks),
    );
  });

  it("does not retry a stalled streaming body", async function () {
    let requestCount = 0;
    globalThis.fetch = async () => {
      requestCount++;
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
      });
    };

    try {
      await chatCompletion({ ...config, timeoutMs: 10 }, [], callbacks);
    } catch (error) {
      assert.match(
        error instanceof Error ? error.message : String(error),
        /timed out or was cancelled/i,
      );
    }
    assert.equal(requestCount, 1);
  });

  it("rejects a truncated stream at EOF", async function () {
    globalThis.fetch = async () => sseResponse([chunk("partial")]);
    await expectRejection(chatCompletion(config, [], callbacks));
  });

  it("rejects a response truncated by the token limit", async function () {
    globalThis.fetch = async () =>
      sseResponse([chunk("partial", "length"), "data: [DONE]\n\n"]);
    await expectRejection(chatCompletion(config, [], callbacks));
  });

  it("rejects content filtered by the provider", async function () {
    globalThis.fetch = async () =>
      sseResponse([chunk("partial", "content_filter"), "data: [DONE]\n\n"]);
    await expectRejection(chatCompletion(config, [], callbacks));
  });

  it("rejects an error event from the provider", async function () {
    globalThis.fetch = async () =>
      sseResponse(['data: {"error":{"message":"provider failed"}}\n\n']);
    await expectRejection(chatCompletion(config, [], callbacks));
  });

  it("rejects a truncated non-streaming response", async function () {
    globalThis.fetch = async () =>
      jsonResponse({
        choices: [
          {
            message: { role: "assistant", content: "partial" },
            finish_reason: "length",
          },
        ],
      });
    await expectRejection(chatCompletionNonStream(config, []));
  });

  it("rejects an invalid non-streaming payload", async function () {
    globalThis.fetch = async () => jsonResponse(null);
    await expectRejection(chatCompletionNonStream(config, []));
  });
});
