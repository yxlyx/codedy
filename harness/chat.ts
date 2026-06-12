import { BASE_URL, API_KEY, MODEL } from "./config";
import { tools } from "./registry";
import type { Message, ChatResponse } from "./types";

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
