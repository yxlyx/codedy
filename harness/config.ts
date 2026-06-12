function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = Bun.env[name];
    if (value) return value;
  }
  return undefined;
}

function requiredEnv(...names: string[]): string {
  const value = readEnv(...names);
  if (value) return value;
  throw new Error(`Missing required environment variable: set ${names.join(" or ")}`);
}

export const BASE_URL = readEnv("CODEGRAFF_BASE_URL", "BASE_URL") ?? "https://gateway.codegraff.com/v1";
export const API_KEY = requiredEnv("CODEGRAFF_API_KEY", "API_KEY");
export const MODEL = readEnv("CODEGRAFF_MODEL", "MODEL") ?? "deepseek-v4-pro";

export const COMPACT_THRESHOLD = parseInt(Bun.env.COMPACT_THRESHOLD ?? "30", 10);
export const ARCHIVE_DIR = Bun.env.ARCHIVE_DIR ?? "/tmp/harness_archive";
export const TASKS_FILE = Bun.env.TASKS_FILE ?? "/tmp/tasks.json";
