import { COMPACT_THRESHOLD } from "./config";
import { chat } from "./chat";
import { compact } from "./compaction";
import { toolRegistry } from "./registry";
import { allTasksDone } from "./tasks";
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
    const result = entry
      ? await entry.fn(tool_args)
      : JSON.stringify({ error: `Unknown tool: ${tool_name}` });
    console.log(`Meta tool call -> ${tool_name}(${JSON.stringify(tool_args)})`);
    return result;
  } catch (e) {
    console.log(`Meta tool call -> parse error for tool_call id=${toolCall.id}`);
    return JSON.stringify({ error: `Failed to parse tool arguments: ${String(e)}`, raw: toolCall.function.arguments });
  }
}

// Runs the agentic loop for one user turn. Mutates `messages` in place and
// returns the final assistant text for the turn.
export async function runTurn(messages: Message[]): Promise<string> {
  let currentResponse = await chat(messages);
  let assistantMessage = currentResponse.choices?.[0]?.message;
  if (assistantMessage?.content) console.log("Thought:", assistantMessage.content);

  while (assistantMessage?.tool_calls?.length && !(await allTasksDone())) {
    messages.push({
      role: assistantMessage.role,
      content: assistantMessage.content,
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      const result = await dispatchToolCall(toolCall);
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

  const finalText = assistantMessage?.content ?? "";
  if (finalText) {
    messages.push({ role: "assistant", content: finalText });
  }
  return finalText;
}
