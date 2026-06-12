const BASE_URL = "https://gateway.codegraff.com/v1";
const API_KEY = "your_codegraff_api_key_here";

type Message = { role: string; content: string | null; tool_call_id?: string; name?: string; tool_calls?: ToolCall[] };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Choice = { message: { role: string; content: string | null; tool_calls?: ToolCall[] } };
type ChatResponse = { choices: Choice[] };

type ToolRegistryEntry = {
  description: string;
  parameters: Record<string, unknown>;
  fn: ToolFn;
};

type ToolFn = (args: Record<string, unknown>) => string | Promise<string>;

const toolRegistry: Record<string, ToolRegistryEntry> = {};

function registerTool(name: string, entry: ToolRegistryEntry) {
  toolRegistry[name] = entry;
}

function buildMetaToolDescription(): string {
  const entries = Object.entries(toolRegistry).map(([name, entry]) => {
    return `- ${name}: ${entry.description}\n  parameters: ${JSON.stringify(entry.parameters)}`;
  });
  return (
    "Dispatch to any available tool. Choose tool_name from the registry below and provide tool_args matching its parameter schema.\n\nAvailable tools:\n" +
    entries.join("\n")
  );
}

const tools = [
  {
    type: "function",
    function: {
      name: "meta_tool",
      get description() { return buildMetaToolDescription(); },
      parameters: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "The name of the tool to invoke from the registry",
          },
          tool_args: {
            type: "object",
            description: "Arguments to pass to the selected tool, matching its parameter schema",
            additionalProperties: true,
          },
        },
        required: ["tool_name", "tool_args"],
        additionalProperties: false,
      },
    },
  },
];

const messages: Message[] = [
  { role: "system", content: "You are a helpful assistant with access to bash, grep, and sed tools. When given a multi-step task, track your progress by maintaining a tasks.json file at /tmp/tasks.json. Use access_bash to read (cat), create (echo/jq), and update it. Each task should have an id, description, status (pending|in_progress|done), and priority (low|medium|high). Work through tasks one by one, updating their status as you go." },
  { role: "user", content: "Improve this harness" },
];

async function chat(msgs: Message[]): Promise<ChatResponse> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: "deepseek-v4-pro", messages: msgs, tools }),
  });
  return res.json() as Promise<ChatResponse>;
}

// ─── Compaction (prevents context rot) ────────────────────────────
const COMPACT_THRESHOLD = parseInt(Bun.env.COMPACT_THRESHOLD ?? "30", 10);

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
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-v4-pro",
      messages: [
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
      ],
    }),
  });
  const data = (await res.json()) as ChatResponse;
  return data.choices[0]?.message?.content ?? "(summary unavailable)";
}

// Linked compaction: raw messages are archived to disk and referenced by id,
// so the model can follow the link via the `recall` tool to read them back.
const ARCHIVE_DIR = Bun.env.ARCHIVE_DIR ?? "/tmp/harness_archive";
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

async function compact(msgs: Message[]): Promise<void> {
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

async function recall(args: Record<string, unknown>): Promise<string> {
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

function get_weather(args: Record<string, unknown>): string {
  const location = args.location;
  const unit = args.unit ?? "celsius";
  return JSON.stringify({ location, temperature: 31, unit, condition: "Sunny" });
}

function add_numbers(args: Record<string, unknown>): string {
  const a = args.a as number;
  const b = args.b as number;
  return JSON.stringify({ result: a + b });
}

function get_time(args: Record<string, unknown>): string {
  return JSON.stringify({ time: new Date().toISOString() });
}

async function access_bash(args: Record<string, unknown>): Promise<string> {
  const command = args.command as string;
  try {
    const result = await Bun.$`bash -c ${command}`.text();
    return JSON.stringify({ stdout: result, exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; exitCode?: number };
    return JSON.stringify({ stderr: e.stderr ?? String(err), exit_code: e.exitCode ?? 1 });
  }
}

async function access_grep(args: Record<string, unknown>): Promise<string> {
  const pattern = args.pattern as string;
  const path = args.path as string;
  const flags = (args.flags as string | undefined) ?? "";
  try {
    const result = await Bun.$`bash -c ${`grep ${flags} ${JSON.stringify(pattern)} ${path}`}`.text();
    return JSON.stringify({ matches: result, exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; exitCode?: number };
    return JSON.stringify({ matches: "", stderr: e.stderr ?? String(err), exit_code: e.exitCode ?? 1 });
  }
}

async function access_sed(args: Record<string, unknown>): Promise<string> {
  const expression = args.expression as string;
  const path = args.path as string;
  try {
    const result = await Bun.$`bash -c ${`sed ${JSON.stringify(expression)} ${path}`}`.text();
    return JSON.stringify({ output: result, exit_code: 0 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; exitCode?: number };
    return JSON.stringify({ output: "", stderr: e.stderr ?? String(err), exit_code: e.exitCode ?? 1 });
  }
}


registerTool("get_weather", {
  description: "Get the current weather for a given location.",
  parameters: {
    type: "object",
    properties: {
      location: { type: "string", description: "City and country in the format 'City, CountryCode', e.g. 'Singapore, SG'", minLength: 3 },
      unit: { type: "string", enum: ["celsius", "fahrenheit"], description: "Temperature unit. Default to celsius." },
    },
    required: ["location", "unit"],
  },
  fn: get_weather,
});

registerTool("add_numbers", {
  description: "Add two numbers together.",
  parameters: {
    type: "object",
    properties: {
      a: { type: "number", description: "First number to add" },
      b: { type: "number", description: "Second number to add" },
    },
    required: ["a", "b"],
  },
  fn: add_numbers,
});

registerTool("get_time", {
  description: "Get the current time.",
  parameters: { type: "object", properties: {}, required: [] },
  fn: get_time,
});

registerTool("access_bash", {
  description: "Run a bash shell command and return its stdout/stderr output.",
  parameters: {
    type: "object",
    properties: { command: { type: "string", description: "The bash command to execute" } },
    required: ["command"],
  },
  fn: access_bash,
});

registerTool("access_grep", {
  description: "Search for a pattern in a file or string using grep. Returns matching lines.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The regex pattern to search for" },
      path: { type: "string", description: "File or directory path to search in" },
      flags: { type: "string", description: "Optional grep flags, e.g. '-r' for recursive, '-i' for case-insensitive" },
    },
    required: ["pattern", "path"],
  },
  fn: access_grep,
});

registerTool("access_sed", {
  description: "Run a sed expression on a file to search/replace text. Returns the transformed output.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "The sed expression, e.g. 's/foo/bar/g'" },
      path: { type: "string", description: "File path to apply the sed expression to" },
    },
    required: ["expression", "path"],
  },
  fn: access_sed,
});

registerTool("recall", {
  description:
    "Retrieve archived raw messages from a compacted segment. Without index, returns a manifest listing each message; with index, returns that specific raw message.",
  parameters: {
    type: "object",
    properties: {
      archive_id: { type: "string", description: "The archive segment id, e.g. 'seg-1'" },
      index: { type: "number", description: "Optional 0-based index of a specific message to retrieve" },
    },
    required: ["archive_id"],
  },
  fn: recall,
});

async function allTasksDone(): Promise<boolean> {
  try {
    const raw = await Bun.$`cat /tmp/tasks.json`.text();
    const tasks = JSON.parse(raw) as Array<{ status: string }>;
    return tasks.length > 0 && tasks.every(t => t.status === "done");
  } catch {
    return false;
  }
}

let currentResponse = await chat(messages);
let assistantMessage = currentResponse.choices[0]?.message;
if (assistantMessage?.content) console.log("Thought:", assistantMessage.content);

while (assistantMessage?.tool_calls?.length && !(await allTasksDone())) {
  messages.push({ role: assistantMessage.role, content: assistantMessage.content, tool_calls: assistantMessage.tool_calls });

  for (const toolCall of assistantMessage.tool_calls) {
    let result: string;
    let tool_name = "(unknown)";
    try {
      const metaArgs = JSON.parse(toolCall.function.arguments) as { tool_name: string; tool_args: Record<string, unknown> };
      tool_name = metaArgs.tool_name;
      const tool_args = metaArgs.tool_args;
      const entry = toolRegistry[tool_name];
      result = entry
        ? await entry.fn(tool_args)
        : JSON.stringify({ error: `Unknown tool: ${tool_name}` });
      console.log(`Meta tool call -> ${tool_name}(${JSON.stringify(tool_args)})`);
    } catch (e) {
      result = JSON.stringify({ error: `Failed to parse tool arguments: ${String(e)}`, raw: toolCall.function.arguments });
      console.log(`Meta tool call -> parse error for tool_call id=${toolCall.id}`);
    }
    console.log(`Tool result: ${result}`);

    messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      name: toolCall.function.name,
      content: result,
    });
  }

  if (messages.length > COMPACT_THRESHOLD && !(await allTasksDone())) {
    await compact(messages);
  }

  currentResponse = await chat(messages);
  if (!currentResponse.choices) {
    console.error("Unexpected response:", JSON.stringify(currentResponse, null, 2));
    break;
  }
  assistantMessage = currentResponse.choices[0]?.message;
  if (assistantMessage?.content) console.log("Thought:", assistantMessage.content);
}

const done = await allTasksDone();
if (done) console.log("All tasks completed.");
console.log("Final answer:", assistantMessage?.content);