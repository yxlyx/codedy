export type EnvSource = Record<string, string | undefined>;

export type HarnessConfig = {
  BASE_URL: string;
  API_KEY: string;
  MODEL: string;
  COMPACT_THRESHOLD: number;
  ARCHIVE_DIR: string;
  TASKS_FILE: string;
};

export function readEnvFrom(env: EnvSource, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) return value;
  }
  return undefined;
}

export function requiredEnvFrom(env: EnvSource, ...names: string[]): string {
  const value = readEnvFrom(env, ...names);
  if (value) return value;
  throw new Error(`Missing required environment variable: set ${names.join(" or ")}`);
}

export function createConfig(env: EnvSource = Bun.env): HarnessConfig {
  return {
    BASE_URL: readEnvFrom(env, "CODEGRAFF_BASE_URL", "BASE_URL") ?? "https://gateway.codegraff.com/v1",
    API_KEY: requiredEnvFrom(env, "CODEGRAFF_API_KEY", "API_KEY"),
    MODEL: readEnvFrom(env, "CODEGRAFF_MODEL", "MODEL") ?? "deepseek-v4-pro",
    COMPACT_THRESHOLD: parseInt(env.COMPACT_THRESHOLD ?? "30", 10),
    ARCHIVE_DIR: env.ARCHIVE_DIR ?? "/tmp/harness_archive",
    TASKS_FILE: env.TASKS_FILE ?? "/tmp/tasks.json",
  };
}

const config = createConfig();

export const BASE_URL = config.BASE_URL;
export const API_KEY = config.API_KEY;
export const MODEL = config.MODEL;
export const COMPACT_THRESHOLD = config.COMPACT_THRESHOLD;
export const ARCHIVE_DIR = config.ARCHIVE_DIR;
export const TASKS_FILE = config.TASKS_FILE;
