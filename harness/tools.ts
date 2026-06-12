import { registerTool } from "./registry";
import { recall } from "./compaction";

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

function get_time(_args: Record<string, unknown>): string {
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
