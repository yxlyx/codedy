const useColor = process.stdout.isTTY && !Bun.env.NO_COLOR;

function wrap(code: string, s: string): string {
  return useColor ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const c = {
  dim: (s: string) => wrap("2", s),
  bold: (s: string) => wrap("1", s),
  cyan: (s: string) => wrap("36", s),
  green: (s: string) => wrap("32", s),
  yellow: (s: string) => wrap("33", s),
  red: (s: string) => wrap("31", s),
  magenta: (s: string) => wrap("35", s),
};

export function truncate(s: string, max = 200): string {
  return s.length > max ? s.slice(0, max) + `… (+${s.length - max} chars)` : s;
}

export function promptUser(): void {
  process.stdout.write(c.bold(c.green("you › ")));
}

export function agentLabel(): void {
  process.stdout.write(c.bold(c.cyan("agent › ")));
}

export function toolLine(name: string, args: string): void {
  console.log(c.dim(`  ⚙ ${name}(${truncate(args, 120)})`));
}

export function toolResultLine(result: string): void {
  console.log(c.dim(`  ↳ ${truncate(result, 200)}`));
}

export function infoLine(text: string): void {
  console.log(c.yellow(`  ℹ ${text}`));
}

export function errorLine(text: string): void {
  console.log(c.red(`  ✗ ${text}`));
}
