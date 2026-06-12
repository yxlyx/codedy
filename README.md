# myharness

so i built my own coding harness from scratch. started as one giant `index.ts` and now its an actual lil agent framework lol. its an interactive agent that runs in ur terminal, talks to an llm, calls tools, and doesnt blow up its own context window.

## features

- **interactive repl** — just type stuff at the `you ›` prompt and the agent goes. has `/exit`, `/reset` and `/help` commands
- **live streaming** — responses stream token by token over SSE so ur not staring at a frozen terminal. it even shows a lil `thinking ...` indicator while the reasoning model is cooking
- **markdown rendering** — agent output gets rendered live in the terminal. headings, bullets, bold, code blocks, the works. colors and everything
- **linked compaction** — this ones my fav. when the convo gets too long it summarizes everything, dumps the raw history to disk as `seg-N.json`, and swaps the context for a tiny summary + a link. no more context rot
- **recall tool** — the agent can follow that link and pull back archived messages whenever it needs the receipts. manifest first, then grab specific messages by index
- **parallel tool calls** — if the model fires off multiple tool calls in one turn they all run at once via `Promise.all`. results still come back in order so the transcript stays clean
- **meta tool registry** — one `meta_tool` dispatcher that routes to a registry of actual tools (bash, grep, sed, weather, etc). adding a new tool is just `registerTool()`
- **task tracking** — for multi-step stuff the agent maintains a `tasks.json` and works thru tasks one by one. casual convo skips all that tho, it just talks to u

## how its laid out

```
harness/
  main.ts        the repl entrypoint
  agent.ts       the agentic loop (runTurn)
  chat.ts        api calls + sse streaming
  compaction.ts  summarize / archive / recall
  render.ts      streaming markdown renderer
  registry.ts    tool registry + meta_tool
  tools.ts       the actual tools
  tasks.ts       tasks.json helpers
  config.ts      env config in one place
  types.ts       shared types
  ui.ts          colors n terminal bits
index.ts         the og single-file version, kept for the culture
```

## running it

install deps:

```bash
bun install
```

run the good version:

```bash
bun start
```

or the og single-file one:

```bash
bun start:legacy
```

## config

everything is env vars, all optional:

| var | what it does | default |
| --- | --- | --- |
| `API_KEY` | gateway api key | (dont hardcode urs) |
| `BASE_URL` | llm gateway url | codegraff gateway |
| `MODEL` | model name | `deepseek-v4-pro` |
| `COMPACT_THRESHOLD` | msgs before compaction kicks in | `30` |
| `ARCHIVE_DIR` | where archived segments go | `/tmp/harness_archive` |
| `TASKS_FILE` | where the task list lives | `/tmp/tasks.json` |

built with [bun](https://bun.com) btw
