import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, ToolCall } from "./types";

const ENV_KEYS = [
  "CODEGRAFF_API_KEY",
  "API_KEY",
  "CODEGRAFF_BASE_URL",
  "BASE_URL",
  "CODEGRAFF_MODEL",
  "MODEL",
  "COMPACT_THRESHOLD",
  "ARCHIVE_DIR",
  "TASKS_FILE",
] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map(key => [key, Bun.env[key]]),
);
const originalFetch = globalThis.fetch;
const archiveDir = await mkdtemp(join(tmpdir(), "codedy-harness-test-"));

Bun.env.CODEGRAFF_API_KEY = "test-key";
Bun.env.CODEGRAFF_BASE_URL = "https://example.test/v1";
Bun.env.CODEGRAFF_MODEL = "test-model";
Bun.env.ARCHIVE_DIR = archiveDir;
delete Bun.env.API_KEY;
delete Bun.env.BASE_URL;
delete Bun.env.MODEL;

const configModule = await import("./config");
const tasksModule = await import("./tasks");
const registryModule = await import("./registry");
const agentModule = await import("./agent");
const chatModule = await import("./chat");
const compactionModule = await import("./compaction");

afterAll(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
  await rm(archiveDir, { recursive: true, force: true });
});

function metaToolCall(args: unknown): ToolCall {
  return {
    id: "call-test",
    type: "function",
    function: {
      name: "meta_tool",
      arguments: JSON.stringify(args),
    },
  };
}

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sse(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

type FetchHandler = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

async function withMockFetch<T>(handler: FetchHandler, run: () => Promise<T>): Promise<T> {
  globalThis.fetch = handler as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("config", () => {
  test("createConfig prefers CODEGRAFF env names and supports legacy aliases", () => {
    const cfg = configModule.createConfig({
      CODEGRAFF_API_KEY: "primary-key",
      API_KEY: "legacy-key",
      CODEGRAFF_BASE_URL: "https://primary.example/v1",
      BASE_URL: "https://legacy.example/v1",
      CODEGRAFF_MODEL: "primary-model",
      MODEL: "legacy-model",
      COMPACT_THRESHOLD: "42",
      ARCHIVE_DIR: "/tmp/archive",
      TASKS_FILE: "/tmp/tasks.json",
    });

    expect(cfg).toEqual({
      BASE_URL: "https://primary.example/v1",
      API_KEY: "primary-key",
      MODEL: "primary-model",
      COMPACT_THRESHOLD: 42,
      ARCHIVE_DIR: "/tmp/archive",
      TASKS_FILE: "/tmp/tasks.json",
    });

    const legacy = configModule.createConfig({
      API_KEY: "legacy-key",
      BASE_URL: "https://legacy.example/v1",
      MODEL: "legacy-model",
    });

    expect(legacy.API_KEY).toBe("legacy-key");
    expect(legacy.BASE_URL).toBe("https://legacy.example/v1");
    expect(legacy.MODEL).toBe("legacy-model");
  });

  test("createConfig rejects missing API credentials", () => {
    expect(() => configModule.createConfig({})).toThrow("CODEGRAFF_API_KEY or API_KEY");
  });
});

describe("tasks", () => {
  test("allTasksDone reads an explicit task file and handles missing files", async () => {
    const tasksFile = join(archiveDir, "tasks.json");

    await writeFile(tasksFile, JSON.stringify([{ status: "done" }, { status: "done" }]));
    expect(await tasksModule.allTasksDone(tasksFile)).toBe(true);

    await writeFile(tasksFile, JSON.stringify([{ status: "done" }, { status: "pending" }]));
    expect(await tasksModule.allTasksDone(tasksFile)).toBe(false);

    expect(await tasksModule.allTasksDone(join(archiveDir, "missing-tasks.json"))).toBe(false);
  });
});

describe("tool dispatch", () => {
  test("dispatchToolCall invokes registered tools and returns structured errors", async () => {
    registryModule.registerTool("echo_test", {
      description: "Echo arguments for tests",
      parameters: { type: "object" },
      fn: args => JSON.stringify({ received: args }),
    });

    const ok = JSON.parse(
      await agentModule.dispatchToolCall(metaToolCall({
        tool_name: "echo_test",
        tool_args: { message: "hello" },
      })),
    ) as { received: { message: string } };
    expect(ok).toEqual({ received: { message: "hello" } });

    const unknown = JSON.parse(
      await agentModule.dispatchToolCall(metaToolCall({ tool_name: "missing_tool", tool_args: {} })),
    ) as { error: string };
    expect(unknown.error).toBe("Unknown tool: missing_tool");

    const malformed = JSON.parse(
      await agentModule.dispatchToolCall({
        id: "bad-call",
        type: "function",
        function: { name: "meta_tool", arguments: "not-json" },
      }),
    ) as { error: string; raw: string };
    expect(malformed.error).toContain("Failed to parse tool arguments");
    expect(malformed.raw).toBe("not-json");
  });
});

describe("chat streaming", () => {
  test("chatStream assembles streamed content and fragmented tool calls", async () => {
    const events = [
      sse({ reasoning_content: "thinking" }),
      sse({ content: "Hel" }),
      sse({ content: "lo" }),
      sse({
        tool_calls: [
          {
            index: 0,
            id: "call-1",
            type: "function",
            function: { name: "meta_", arguments: '{"tool_name":"echo_' },
          },
        ],
      }),
      sse({
        tool_calls: [
          {
            index: 0,
            function: { name: "tool", arguments: 'test","tool_args":{}}' },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ].join("");
    const chunks = [events.slice(0, 37), events.slice(37, 143), events.slice(143)];
    const tokens: string[] = [];
    const reasoning: string[] = [];

    await withMockFetch(
      async (input, init) => {
        expect(String(input)).toBe("https://example.test/v1/chat/completions");
        const body = JSON.parse(String(init?.body));
        expect(body.model).toBe("test-model");
        expect(body.stream).toBe(true);

        return new Response(streamFromChunks(chunks), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      },
      async () => {
        const message = await chatModule.chatStream(
          [{ role: "user", content: "hello" }],
          token => tokens.push(token),
          token => reasoning.push(token),
        );

        expect(message.content).toBe("Hello");
        expect(message.tool_calls?.[0]).toEqual({
          id: "call-1",
          type: "function",
          function: {
            name: "meta_tool",
            arguments: '{"tool_name":"echo_test","tool_args":{}}',
          },
        });
      },
    );

    expect(tokens).toEqual(["Hel", "lo"]);
    expect(reasoning).toEqual(["thinking"]);
  });
});

describe("compaction", () => {
  test("compact archives prior messages and recall reads them back", async () => {
    await withMockFetch(
      async () => {
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: "assistant", content: "dense summary" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
      async () => {
        const messages: Message[] = [
          { role: "system", content: "system prompt" },
          { role: "user", content: "do the task" },
          { role: "assistant", content: "done" },
        ];

        await compactionModule.compact(messages);

        expect(messages).toHaveLength(2);
        expect(messages[0]).toEqual({ role: "system", content: "system prompt" });
        expect(messages[1]?.content).toContain('Raw history archived as "seg-1"');
        expect(messages[1]?.content).toContain("dense summary");

        const manifest = JSON.parse(
          await compactionModule.recall({ archive_id: "seg-1" }),
        ) as { archive_id: string; count: number; manifest: string };
        expect(manifest.archive_id).toBe("seg-1");
        expect(manifest.count).toBe(2);
        expect(manifest.manifest).toContain("[0] user");

        const firstMessage = JSON.parse(
          await compactionModule.recall({ archive_id: "seg-1", index: 0 }),
        ) as Message;
        expect(firstMessage).toEqual({ role: "user", content: "do the task" });
      },
    );
  });
});
