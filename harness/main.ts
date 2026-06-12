import "./tools";
import { runTurn } from "./agent";
import { allTasksDone } from "./tasks";
import { c, infoLine, promptUser } from "./ui";
import type { Message } from "./types";

const messages: Message[] = [
  {
    role: "system",
    content:
      "You are a helpful assistant with access to bash, grep, and sed tools. For casual conversation or simple questions, just respond directly — do NOT use tools or create task files. Only when given a genuinely multi-step task should you track progress by maintaining a tasks.json file at /tmp/tasks.json (use access_bash to read, create, and update it; each task has an id, description, status (pending|in_progress|done), and priority (low|medium|high)). Work through tasks one by one, updating their status as you go.",
  },
];

// Tracks done-state so we only announce completion when it transitions during
// this session (a stale tasks.json from a previous run shouldn't announce).
let wasDone = await allTasksDone();

console.log(c.bold("Interactive harness") + c.dim(" — responses stream live"));
console.log(c.dim("Commands: /exit quit · /reset clear history · /help show this"));
console.log();
promptUser();

for await (const line of console) {
  const input = line.trim();

  if (!input) {
    promptUser();
    continue;
  }
  if (input === "/exit") break;
  if (input === "/help") {
    console.log(c.dim("Commands: /exit quit · /reset clear history · /help show this"));
    promptUser();
    continue;
  }
  if (input === "/reset") {
    messages.splice(1, messages.length - 1);
    infoLine("History cleared.");
    promptUser();
    continue;
  }

  messages.push({ role: "user", content: input });
  try {
    const answer = await runTurn(messages);
    if (!answer) infoLine("(no response)");
  } catch (e) {
    infoLine(`Turn failed: ${String(e)}`);
  }

  const isDone = await allTasksDone();
  if (isDone && !wasDone) infoLine("All tasks completed.");
  wasDone = isDone;
  console.log();
  promptUser();
}

console.log(c.dim("Bye."));
