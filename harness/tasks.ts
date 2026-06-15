import { TASKS_FILE } from "./config";

export async function allTasksDone(tasksFile = TASKS_FILE): Promise<boolean> {
  try {
    const raw = await Bun.file(tasksFile).text();
    const tasks = JSON.parse(raw) as Array<{ status: string }>;
    return tasks.length > 0 && tasks.every(t => t.status === "done");
  } catch {
    return false;
  }
}
