import { ChatCompletionChunk } from "./types";

export async function* parseSSEStream(
  response: Response,
): AsyncIterable<ChatCompletionChunk> {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is null");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);

        if (payload === "[DONE]") return;

        try {
          yield JSON.parse(payload) as ChatCompletionChunk;
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    // flush remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
        try {
          yield JSON.parse(trimmed.slice(6)) as ChatCompletionChunk;
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
