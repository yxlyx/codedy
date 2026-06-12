import { COMPACT_THRESHOLD } from "./config";
import { chatStream } from "./chat";
import { compact } from "./compaction";
import { toolRegistry } from "./registry";
import { allTasksDone } from "./tasks";
import { agentLabel, c, errorLine, infoLine, toolLine, toolResultLine } from "./ui";
import type { Message, ToolCall } from "./types";

async function dispatchToolCall(toolCall: ToolCall): Promise<string> {
  let tool_name = "(unknown)";
  try {
    const metaArgs = JSON.parse(toolCall.function.arguments) as {
      tool_name: string;
      tool_args: Record<string, unknown>;
    };
    tool_name = metaArgs.tool_name;
    const tool_args = metaArgs.tool_args;
    const entry = toolRegistry[tool_name];
    toolLine(tool_name, JSON.stringify(tool_args));
    const result = entry
      ? await entry.fn(tool_args)
      : JSON.stringify({ error: `Unknown tool: ${tool_name}` });
    return result;
  } catch (e) {
    errorLine(`Could not parse tool arguments for call ${toolCall.id}`);
    return JSON.stringify({ error: `Failed to parse tool arguments: ${String(e)}`, raw: toolCall.function.arguments });
  }
}

// Streams one assistant response, printing tokens live under the agent label.
// Reasoning models emit "thinking" deltas before any content; we surface those
// as a live dim indicator so the terminal never looks stuck.
async function streamAssistant(messages: Message[]) {
  let printedLabel = false;
  let thinkingChars = 0;

  const clearThinking = () => {
    if (thinkingChars > 0 && process.stdout.isTTY) {
      process.stdout.write("\r\x1b[2K");
    } else if (thinkingChars > 0) {
      process.stdout.write("\n");
    }
    thinkingChars = 0;
  };

  const msg = await chatStream(
    messages,
    token => {
      clearThinking();
      if (!printedLabel) {
        agentLabel();
        printedLabel = true;
      }
      process.stdout.write(token);
    },
    () => {
      if (printedLabel) return;
      if (thinkingChars === 0) {
        process.stdout.write(c.dim("thinking "));
        thinkingChars = 9;
      } else if (thinkingChars < 40) {
        process.stdout.write(c.dim("."));
        thinkingChars++;
      }
    },
  );
  clearThinking();
  if (printedLabel) process.stdout.write("\n");
  return msg;
}

// Runs the agentic loop for one user turn. Mutates `messages` in place and
// returns the final assistant text for the turn.
export async function runTurn(messages: Message[]): Promise<string> {
  // Only treat "all tasks done" as a stop signal if it became true during
  // this turn — a stale tasks.json from a previous run must not block work.
  const doneAtStart = await allTasksDone();
  const justCompleted = async () => !doneAtStart && (await allTasksDone());

  let assistantMessage = await streamAssistant(messages);

  while (assistantMessage.tool_calls?.length && !(await justCompleted())) {
    messages.push({
      role: assistantMessage.role,
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    // Execute all tool calls in parallel, then append results in the
    // original call order so the transcript stays deterministic.
    const results = await Promise.all(
      assistantMessage.tool_calls.map(toolCall => dispatchToolCall(toolCall)),
    );
    assistantMessage.tool_calls.forEach((toolCall, i) => {
      const result = results[i] ?? JSON.stringify({ error: "missing tool result" });
      toolResultLine(result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: result,
      });
    });

    if (messages.length > COMPACT_THRESHOLD && !(await justCompleted())) {
      infoLine("Compacting history...");
      await compact(messages);
    }

    try {
      assistantMessage = await streamAssistant(messages);
    } catch (e) {
      errorLine(String(e));
      break;
    }
  }

  const finalText = assistantMessage?.content ?? "";
  if (finalText) {
    messages.push({ role: "assistant", content: finalText });
  }
  return finalText;
}
