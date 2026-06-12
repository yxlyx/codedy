# Architecture

This document explains how **codedy** works internally — the components, the request/response flow, and the key design decisions. It's meant as a guide for explaining the system to others.

## Overview

codedy is an **interactive agentic CLI harness**. A user types a message in the terminal; the harness sends the conversation to an OpenAI-compatible chat-completions gateway; the model can either reply directly or call tools. When it calls tools, the harness runs them, feeds the results back, and lets the model continue — looping until the model produces a final answer. Responses stream to the terminal token-by-token.

```
┌──────────┐   message    ┌─────────────┐   HTTP/SSE   ┌──────────────┐
│  User    │ ───────────▶ │  main.ts    │ ───────────▶ │   Gateway    │
│ (stdin)  │              │  (REPL)     │ ◀─────────── │ (LLM + tools)│
└──────────┘              └─────┬───────┘   tokens     └──────────────┘
      ▲                         │
      │  streamed output        │ tool calls
      │                         ▼
      │                   ┌─────────────┐   dispatch   ┌──────────────┐
      └────────────────── │  agent.ts   │ ───────────▶ │  tools.ts    │
                          │ (turn loop) │ ◀─────────── │ (bash/grep…) │
                          └─────────────┘   results    └──────────────┘
```

## Components

The codebase lives in `harness/`, split by concern:

| File | Responsibility |
| --- | --- |
| `main.ts` | Entry point. Runs the REPL: reads stdin lines, handles slash commands (`/exit`, `/reset`, `/help`), seeds the system prompt, and announces when all tasks complete. |
| `agent.ts` | The agentic turn loop. Streams one assistant response, dispatches any tool calls in parallel, appends results, compacts if needed, and repeats until the model stops calling tools. |
| `chat.ts` | The gateway client. `chatStream` does streaming completions (SSE), `completion` does a plain non-streaming call (used by compaction), `chat` is a non-streaming variant. |
| `registry.ts` | The tool registry and the single `meta_tool` schema that is actually advertised to the model. |
| `tools.ts` | Concrete tool implementations (`access_bash`, `access_grep`, `access_sed`, `recall`) and their registrations. |
| `compaction.ts` | History compaction: summarize the transcript, archive raw messages to disk, and the `recall` tool to read them back. |
| `tasks.ts` | Reads `tasks.json` to detect when every tracked task is `done`. |
| `render.ts` | Streaming markdown → ANSI renderer for readable terminal output. |
| `ui.ts` | Colors, prompts, and log-line helpers. |
| `config.ts` | Environment-driven configuration (base URL, API key, model, thresholds, paths). |
| `types.ts` | Shared `Message`, `ToolCall`, and registry types. |

## The turn loop

This is the heart of the system, in `agent.ts`:

1. **Stream the assistant response.** `streamAssistant` calls `chatStream`, printing content tokens live. Reasoning models emit `reasoning_content` deltas first, which are surfaced as a dim "thinking…" indicator so the terminal never looks frozen.
2. **Check for tool calls.** If the assembled assistant message has `tool_calls`, the loop continues; otherwise the turn is over.
3. **Dispatch tools in parallel.** All tool calls in a single assistant message are executed concurrently with `Promise.all`, then their results are appended **in original call order** so the transcript stays deterministic.
4. **Compact if needed.** If the message count exceeds `COMPACT_THRESHOLD`, the history is compacted (see below).
5. **Repeat.** Stream the next assistant response with the tool results now in context.

The loop also stops early if all tasks become `done` *during this turn* — a stale `tasks.json` from a previous run is ignored via a `doneAtStart` snapshot.

## Tool dispatch: the meta-tool pattern

Rather than advertising every tool to the model directly, codedy exposes a **single `meta_tool`** (`registry.ts`). Its description is generated dynamically from the registry, listing every available tool and its parameter schema. The model calls `meta_tool` with:

```json
{ "tool_name": "access_bash", "tool_args": { "command": "ls -la" } }
```

`dispatchToolCall` in `agent.ts` parses that envelope, looks up `tool_name` in `toolRegistry`, and invokes its `fn`. Unknown tools and malformed arguments return structured `{ error: ... }` JSON instead of throwing, so a bad call never crashes the turn.

**Why this pattern?** Adding a tool is a single `registerTool(...)` call in `tools.ts` — no schema duplication, no changes to the dispatch code, and the model always sees an up-to-date list.

## Streaming

`chatStream` (`chat.ts`) reads the gateway's server-sent-events stream:

- Buffers raw bytes, splits on newlines, and parses each `data:` line as JSON.
- Accumulates `content` deltas (emitted live via the `onToken` callback) and `reasoning_content` deltas (via `onReasoning`).
- Reassembles `tool_calls` from their streamed fragments by `index`, concatenating partial `name`/`arguments` strings.

The result is a single assembled `AssistantMessage` with the full content and any tool calls.

## History compaction & recall

Long sessions blow past the context window, so `compaction.ts` keeps history bounded:

1. **Summarize.** A separate non-streaming `completion` call compresses the trajectory into a structured summary (goal, progress, files touched, task state, next steps).
2. **Archive.** The raw pre-compaction messages are written to disk as `seg-N.json` under `ARCHIVE_DIR`.
3. **Replace.** The live history is collapsed to `[system prompt, summary]`, where the summary includes a pointer to the archive id.
4. **Recall.** The `recall` tool lets the model read archived messages back — either a manifest of the segment or a specific message by index — so no information is permanently lost.

This is "linked compaction": the working context stays small, but the full detail is one tool call away.

## Task tracking

For genuinely multi-step work, the system prompt (`main.ts`) instructs the model to maintain a `tasks.json` file (path from `TASKS_FILE`) via the `access_bash` tool, where each task has an `id`, `description`, `status` (`pending`/`in_progress`/`done`), and `priority`. `tasks.ts` reads that file; `allTasksDone()` returns true only when the file has tasks and every one is `done`. The harness announces completion only on the transition to done within a session, so casual chat never triggers task machinery.

## Configuration

All runtime knobs come from environment variables (`config.ts`), with sensible defaults:

- `BASE_URL`, `API_KEY`, `MODEL` — gateway connection.
- `COMPACT_THRESHOLD` — when to compact.
- `ARCHIVE_DIR`, `TASKS_FILE` — on-disk paths for archives and the task list.

## Data model

The conversation is an array of `Message` objects (`types.ts`) following the OpenAI chat format:

- `system` — the initial instructions.
- `user` — user input.
- `assistant` — model output, optionally with `tool_calls`.
- `tool` — a tool result, linked back to its call via `tool_call_id`.

This array is mutated in place by the turn loop and is the single source of truth for the conversation.

## Design principles

- **Single source of truth for tools** — the registry drives both dispatch and the model-facing schema.
- **Fail soft** — tool errors become structured JSON, not exceptions, so the loop keeps going.
- **Deterministic transcripts** — parallel tool execution, ordered result append.
- **Bounded context, lossless history** — compaction summarizes while archiving the raw detail for recall.
- **Terminal-first UX** — live streaming, thinking indicators, and markdown rendering keep the CLI responsive and readable.
