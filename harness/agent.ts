import { COMPACT_THRESHOLD } from "./config";
import { chatStream } from "./chat";
import { compact } from "./compaction";
import { toolRegistry } from "./registry";
import { allTasksDone } from "./tasks";
import { agentLabel, errorLine, infoLine, toolLine, toolResultLine } from "./ui";
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
async function streamAssistant(messages: Message[]) {
  let printedLabel = false;
  const msg = await chatStream(messages, token => {
    if (!printedLabel) {
      agentLabel();
      printedLabel = true;
    }
    process.stdout.write(token);
  });
  if (printedLabel) process.stdout.write("\n");
  return msg;
}

// Runs the agentic loop for one user turn. Mutates `messages` in place and
// returns the final assistant text for the turn.
export async function runTurn(messages: Message[]): Promise<string> {
  let assistantMessage = await streamAssistant(messages);

  while (assistantMessage.tool_calls?.length && !(await allTasksDone())) {
    messages.push({
      role: assistantMessage.role,
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      const result = await dispatchToolCall(toolCall);
      toolResultLine(result);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: result,
      });
    }

    if (messages.length > COMPACT_THRESHOLD && !(await allTasksDone())) {
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
