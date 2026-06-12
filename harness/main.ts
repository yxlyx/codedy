import "./tools";
import { runTurn } from "./agent";
import { allTasksDone } from "./tasks";
import { c, infoLine, promptUser } from "./ui";
import type { Message } from "./types";

const messages: Message[] = [
  {
    role: "system",
    content:
      "You are a helpful assistant with access to bash, grep, and sed tools. When given a multi-step task, track your progress by maintaining a tasks.json file at /tmp/tasks.json. Use access_bash to read (cat), create (echo/jq), and update it. Each task should have an id, description, status (pending|in_progress|done), and priority (low|medium|high). Work through tasks one by one, updating their status as you go.",
  },
];

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

  if (await allTasksDone()) infoLine("All tasks completed.");
  console.log();
  promptUser();
}

console.log(c.dim("Bye."));
