import { BASE_URL, API_KEY, MODEL } from "./config";
import { tools } from "./registry";
import type { Message, ChatResponse, ToolCall } from "./types";

export async function chat(msgs: Message[]): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages: msgs, tools }),
  });
  return res.json() as Promise<ChatResponse>;
}

type StreamDelta = {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
};

export type AssistantMessage = {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
};

// Streams a chat completion. Calls onToken for each content fragment as it
// arrives, and returns the fully assembled assistant message (including any
// tool calls accumulated from deltas).
export async function chatStream(
  msgs: Message[],
  onToken: (token: string) => void,
  onReasoning?: (token: string) => void,
): Promise<AssistantMessage> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages: msgs, tools, stream: true }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stream request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  let content = "";
  const toolCalls: ToolCall[] = [];
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;

      let delta: StreamDelta | undefined;
      try {
        const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: StreamDelta }> };
        delta = parsed.choices?.[0]?.delta;
      } catch {
        continue;
      }
      if (!delta) continue;

      if (delta.reasoning_content) {
        onReasoning?.(delta.reasoning_content);
      }

      if (delta.content) {
        content += delta.content;
        onToken(delta.content);
      }

      for (const tc of delta.tool_calls ?? []) {
        const existing = toolCalls[tc.index];
        if (!existing) {
          toolCalls[tc.index] = {
            id: tc.id ?? "",
            type: "function",
            function: {
              name: tc.function?.name ?? "",
              arguments: tc.function?.arguments ?? "",
            },
          };
        } else {
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.function.name += tc.function.name;
          if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
        }
      }
    }
  }

  return {
    role: "assistant",
    content: content || null,
    tool_calls: toolCalls.length ? toolCalls : undefined,
  };
}

export async function completion(msgs: Message[]): Promise<string> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages: msgs }),
  });
  const data = (await res.json()) as ChatResponse;
  return data.choices[0]?.message?.content ?? "";
}
