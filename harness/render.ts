import { c } from "./ui";

// Streaming markdown renderer: buffers tokens until a full line is available,
// then renders that line with ANSI styling. Keeps the live-streaming feel
// while making headings, code, lists, and emphasis readable in the terminal.
export class MarkdownStream {
  private buffer = "";
  private inCodeFence = false;

  feed(token: string): void {
    this.buffer += token;
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      process.stdout.write(this.renderLine(line) + "\n");
    }
  }

  // Flush any trailing partial line (no newline at end of stream).
  flush(): void {
    if (this.buffer.length > 0) {
      process.stdout.write(this.renderLine(this.buffer));
      this.buffer = "";
    }
    this.inCodeFence = false;
  }

  private renderLine(line: string): string {
    if (line.trimStart().startsWith("```")) {
      this.inCodeFence = !this.inCodeFence;
      return c.dim(line);
    }
    if (this.inCodeFence) {
      return c.yellow(line);
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      return c.bold(c.magenta(heading[2] ?? ""));
    }

    if (line.trimStart().startsWith("> ")) {
      return c.dim(line);
    }

    let out = line;
    // Bullet markers
    out = out.replace(/^(\s*)[-*]\s+/, (_m, indent: string) => `${indent}${c.cyan("•")} `);
    // Bold, then inline code (bold first so ** isn't eaten by code styling)
    out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => c.bold(t));
    out = out.replace(/`([^`]+)`/g, (_m, t: string) => c.yellow(t));
    return out;
  }
}
