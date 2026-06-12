export type Message = {
  role: string;
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: ToolCall[];
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type Choice = {
  message: { role: string; content: string | null; tool_calls?: ToolCall[] };
};

export type ChatResponse = { choices: Choice[] };

export type ToolFn = (args: Record<string, unknown>) => string | Promise<string>;

export type ToolRegistryEntry = {
  description: string;
  parameters: Record<string, unknown>;
  fn: ToolFn;
};
