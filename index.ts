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

let currentResponse = await chat(messages);
let assistantMessage = currentResponse.choices[0]?.message;
if (assistantMessage?.content) console.log("Thought:", assistantMessage.content);

while (assistantMessage?.tool_calls?.length) {
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

  currentResponse = await chat(messages);
  if (!currentResponse.choices) {
    console.error("Unexpected response:", JSON.stringify(currentResponse, null, 2));
    break;
  }
  assistantMessage = currentResponse.choices[0]?.message;
  if (assistantMessage?.content) console.log("Thought:", assistantMessage.content);
}

console.log("Final answer:", assistantMessage?.content);