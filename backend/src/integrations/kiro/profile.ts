export const triageAgentName = "resolva-triage";

export function buildTriageProfile(sourcePaths: readonly string[], reportPath: string) {
  return {
    name: triageAgentName,
    description: "Triagem de tickets Resolva com acesso restrito a fontes selecionadas.",
    tools: ["read_file", "fs_write"],
    includeMcpJson: false,
    includePowers: false,
    resources: [],
    permissions: {
      rules: [
        {
          capability: "fs_read",
          effect: "deny",
          ...(sourcePaths.length > 0 ? { exclude: sourcePaths } : {}),
        },
        ...(sourcePaths.length > 0
          ? [{ capability: "fs_read", match: sourcePaths, effect: "allow" }]
          : []),
        { capability: "fs_write", exclude: [reportPath], effect: "deny" },
        { capability: "fs_write", match: [reportPath], effect: "allow" },
        ...[
          "shell",
          "mcp",
          "subagent",
          "web_fetch",
          "web_search",
          "skill",
          "power",
          "sandbox_network",
        ].map((capability) => ({ capability, effect: "deny" })),
      ],
    },
  };
}
