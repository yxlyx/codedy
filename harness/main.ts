import "./tools";
import { runTurn } from "./agent";
import { allTasksDone } from "./tasks";
import type { Message } from "./types";

const messages: Message[] = [
  {
    role: "system",
    content:
      "You are a helpful assistant with access to bash, grep, and sed tools. When given a multi-step task, track your progress by maintaining a tasks.json file at /tmp/tasks.json. Use access_bash to read (cat), create (echo/jq), and update it. Each task should have an id, description, status (pending|in_progress|done), and priority (low|medium|high). Work through tasks one by one, updating their status as you go.",
  },
];

console.log("Interactive harness. Type a task and press enter. Commands: /exit to quit, /reset to clear history.");
process.stdout.write("you> ");

for await (const line of console) {
  const input = line.trim();

  if (!input) {
    process.stdout.write("you> ");
    continue;
  }
  if (input === "/exit") break;
  if (input === "/reset") {
    messages.splice(1, messages.length - 1);
    console.log("History cleared.");
    process.stdout.write("you> ");
    continue;
  }

  messages.push({ role: "user", content: input });
  const answer = await runTurn(messages);

  if (await allTasksDone()) console.log("All tasks completed.");
  console.log(`agent> ${answer || "(no response)"}`);
  process.stdout.write("you> ");
}

console.log("Bye.");
