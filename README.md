# codedy

A minimal, hackable **interactive agentic CLI harness** built with [Bun](https://bun.sh) and TypeScript. It connects to an OpenAI-compatible chat-completions gateway, streams responses live in the terminal, and gives the model a set of tools (bash, grep, sed, and more) that it can call to work through multi-step tasks.

## Features

- **Live streaming** — assistant tokens render as they arrive, with a "thinking" indicator for reasoning models.
- **Agentic tool loop** — the model can call tools, see their results, and keep going until the turn is done.
- **Meta-tool dispatch** — a single `meta_tool` exposes the whole tool registry, so adding a tool is a one-line `registerTool(...)` call.
- **Built-in tools** — `access_bash`, `access_grep`, `access_sed`, and `recall`.
- **Task tracking** — for genuinely multi-step work the agent maintains a `tasks.json` file and the harness announces when all tasks are done.
- **History compaction** — once the transcript grows past a threshold, older messages are summarized and archived to disk; the model can read raw messages back via the `recall` tool.
- **Terminal markdown rendering** — headings, lists, bold, inline code, and code fences are styled with ANSI colors.

## Requirements

- [Bun](https://bun.sh) (v1+)
- An API key for an OpenAI-compatible chat-completions gateway

## Installation

```bash
bun install
```

## Configuration

Configuration is read from environment variables (see `harness/config.ts`). You can place them in a `.env` file:

| Variable | Default | Description |
| --- | --- | --- |
| `CODEGRAFF_API_KEY` | _(required)_ | API key sent as the `Authorization: Bearer` header. `API_KEY` is also supported as a compatibility alias. |
| `CODEGRAFF_BASE_URL` | `https://gateway.codegraff.com/v1` | Base URL of the chat-completions endpoint. `BASE_URL` is also supported as a compatibility alias. |
| `CODEGRAFF_MODEL` | `deepseek-v4-pro` | Model name to request. `MODEL` is also supported as a compatibility alias. |
| `COMPACT_THRESHOLD` | `30` | Message count that triggers history compaction. |
| `ARCHIVE_DIR` | `/tmp/harness_archive` | Where compacted raw messages are archived. |
| `TASKS_FILE` | `/tmp/tasks.json` | Path to the agent's task list. |

> **Security note:** The harness intentionally does not include a fallback API key. Set `CODEGRAFF_API_KEY` or `API_KEY` via your environment and avoid committing real secrets.

## Usage

Start the interactive harness:

```bash
bun start
```

You'll get a `you ›` prompt. Type a message and the agent responds, streaming live.

### Commands

| Command | Action |
| --- | --- |
| `/exit` | Quit the harness |
| `/reset` | Clear conversation history (keeps the system prompt) |
| `/help` | Show available commands |

There is also a legacy single-file entry point:

```bash
bun start:legacy   # runs index.ts
```

## Project structure

```
harness/
  main.ts         # entry point: REPL loop, slash commands, task-done announcements
  agent.ts        # one-turn agentic loop: stream, dispatch tool calls, compact
  chat.ts         # gateway client: chat, chatStream (SSE), completion
  registry.ts     # tool registry + the meta_tool schema sent to the model
  tools.ts        # built-in tool implementations and their registrations
  compaction.ts   # summarize + archive history; recall archived messages
  tasks.ts        # reads tasks.json to detect when all tasks are done
  render.ts       # streaming markdown -> ANSI terminal renderer
  ui.ts           # colors, prompts, and log line helpers
  config.ts       # environment-driven configuration
  types.ts        # shared message/tool types
index.ts          # legacy single-file harness
```

## Adding a tool

Implement a function and register it in `harness/tools.ts`:

```ts
registerTool("my_tool", {
  description: "What the tool does.",
  parameters: {
    type: "object",
    properties: { foo: { type: "string", description: "..." } },
    required: ["foo"],
  },
  fn: (args) => JSON.stringify({ ok: true }),
});
```

It's immediately available to the model through `meta_tool` — no other wiring needed.
