export const BASE_URL = Bun.env.BASE_URL ?? "https://gateway.codegraff.com/v1";
export const API_KEY = Bun.env.API_KEY ?? "your_codegraff_api_key_here";
export const MODEL = Bun.env.MODEL ?? "deepseek-v4-pro";

export const COMPACT_THRESHOLD = parseInt(Bun.env.COMPACT_THRESHOLD ?? "30", 10);
export const ARCHIVE_DIR = Bun.env.ARCHIVE_DIR ?? "/tmp/harness_archive";
export const TASKS_FILE = Bun.env.TASKS_FILE ?? "/tmp/tasks.json";
