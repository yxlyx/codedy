import { ARCHIVE_DIR } from "./config";
import { completion } from "./chat";
import type { Message } from "./types";

function renderTranscript(msgs: Message[]): string {
  return msgs
    .filter(m => m.role !== "system")
    .map(m => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        const calls = m.tool_calls
          .map(tc => `${tc.function.name}(${tc.function.arguments})`)
          .join(", ");
        return `ASSISTANT: ${m.content ?? ""}\n  -> tool calls: ${calls}`;
      }
      if (m.role === "tool") return `TOOL RESULT (${m.name}): ${m.content}`;
      return `${m.role.toUpperCase()}: ${m.content ?? ""}`;
    })
    .join("\n");
}

async function summarize(msgs: Message[]): Promise<string> {
  const summary = await completion([
    {
      role: "system",
      content:
        "You compress an agent's working trajectory into a dense summary so it can continue without the full history. Output these sections:\n" +
        "1. GOAL: the original task.\n" +
        "2. PROGRESS: what has been done so far, with key command results.\n" +
        "3. FILES: every file path read/created/modified and a one-line note of its contents/purpose so they can be relocated.\n" +
        "4. TASK STATE: current status of tasks in /tmp/tasks.json.\n" +
        "5. NEXT STEPS: the immediate actions still required.\n" +
        "Be specific with paths and facts. Do not invent anything.",
    },
    { role: "user", content: `Summarize this trajectory:\n\n${renderTranscript(msgs)}` },
  ]);
  return summary || "(summary unavailable)";
}

// Linked compaction: raw messages are archived to disk and referenced by id,
// so the model can follow the link via the `recall` tool to read them back.
let archiveSeq = 0;

async function archiveMessages(msgs: Message[]): Promise<string> {
  archiveSeq++;
  const id = `seg-${archiveSeq}`;
  await Bun.write(`${ARCHIVE_DIR}/${id}.json`, JSON.stringify(msgs, null, 2));
  return id;
}

function manifest(msgs: Message[]): string {
  return msgs
    .map((m, i) => {
      const preview = (m.content ?? (m.tool_calls?.length ? "[tool calls]" : "")).slice(0, 80);
      return `  [${i}] ${m.role}${m.name ? `(${m.name})` : ""}: ${preview}`;
    })
    .join("\n");
}

export async function compact(msgs: Message[]): Promise<void> {
  const system: Message = msgs[0] ?? { role: "system", content: "" };
  const body = msgs.slice(1);
  const summary = await summarize(msgs);
  const archiveId = await archiveMessages(body);
  const link =
    `[CONTEXT SUMMARY OF PRIOR WORK]\n\n` +
    `Raw history archived as "${archiveId}" (${body.length} messages). ` +
    `Call recall with {"archive_id":"${archiveId}"} for the manifest, or ` +
    `{"archive_id":"${archiveId}","index":N} to read a specific raw message.\n\n` +
    summary;
  msgs.splice(0, msgs.length,
    system,
    { role: "user", content: link },
  );
  console.log(`Compacted history -> archived ${body.length} msgs as ${archiveId}, now ${msgs.length} messages`);
}

export async function recall(args: Record<string, unknown>): Promise<string> {
  const archiveId = args.archive_id as string;
  if (!archiveId || typeof archiveId !== "string") {
    return JSON.stringify({ error: "archive_id must be a non-empty string" });
  }
  try {
    const raw = await Bun.file(`${ARCHIVE_DIR}/${archiveId}.json`).text();
    const msgs = JSON.parse(raw) as Message[];
    if (args.index !== undefined) {
      const i = Number(args.index);
      if (!Number.isInteger(i) || i < 0 || i >= msgs.length) {
        return JSON.stringify({ error: `index out of range (0..${msgs.length - 1})` });
      }
      return JSON.stringify(msgs[i]);
    }
    return JSON.stringify({ archive_id: archiveId, count: msgs.length, manifest: manifest(msgs) });
  } catch {
    return JSON.stringify({ error: `No archive segment: ${archiveId}` });
  }
}
