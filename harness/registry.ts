import type { ToolRegistryEntry } from "./types";

export const toolRegistry: Record<string, ToolRegistryEntry> = {};

export function registerTool(name: string, entry: ToolRegistryEntry) {
  toolRegistry[name] = entry;
}

function buildMetaToolDescription(): string {
  const entries = Object.entries(toolRegistry).map(([name, entry]) => {
    return `- ${name}: ${entry.description}\n  parameters: ${JSON.stringify(entry.parameters)}`;
  });
  return (
    "Dispatch to any available tool. Choose tool_name from the registry below and provide tool_args matching its parameter schema.\n\nAvailable tools:\n" +
    entries.join("\n")
  );
}

export const tools = [
  {
    type: "function",
    function: {
      name: "meta_tool",
      get description() { return buildMetaToolDescription(); },
      parameters: {
        type: "object",
        properties: {
          tool_name: {
            type: "string",
            description: "The name of the tool to invoke from the registry",
          },
          tool_args: {
            type: "object",
            description: "Arguments to pass to the selected tool, matching its parameter schema",
            additionalProperties: true,
          },
        },
        required: ["tool_name", "tool_args"],
        additionalProperties: false,
      },
    },
  },
];
