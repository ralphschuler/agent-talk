import {
  McpServer,
  type RegisteredTool,
  type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  safeParseAsync,
  type AnySchema,
  type ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";

const shortcuts = {
  "/contact invite": "profile_export_invite",
  "/contact confirm": "contact_confirm",
  "/contact block": "contact_block",
  "/contact reverify": "contact_reverify",
  "/group create": "group_create",
  "/group invite": "group_invite",
  "/group accept": "group_accept",
  "/group add": "group_add",
  "/group remove": "group_remove",
  "/group grant": "group_grant",
  "/group revoke": "group_revoke",
  "/group leave": "group_leave",
  "/group close": "group_close",
} as const;

type OwnerContext = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Keep shortcuts on the local MCP request path, using the original tool's validation and owner form. */
export class AgentTalkServer extends McpServer {
  private readonly managementTools = new Map<string, RegisteredTool>();

  override registerTool<
    O extends ZodRawShapeCompat | AnySchema,
    I extends ZodRawShapeCompat | AnySchema | undefined = undefined,
  >(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: I;
      outputSchema?: O;
      annotations?: ToolAnnotations;
      _meta?: Record<string, unknown>;
    },
    handler: ToolCallback<I>,
  ): RegisteredTool {
    const registered = super.registerTool<O, I>(name, config, handler);
    if (Object.values<string>(shortcuts).includes(name)) this.managementTools.set(name, registered);
    return registered;
  }

  registerShortcuts(ownerApproval: (message: string) => Promise<void>): void {
    const commands = Object.keys(shortcuts) as [
      keyof typeof shortcuts,
      ...(keyof typeof shortcuts)[],
    ];
    this.registerTool(
      "management_shortcut",
      {
        description:
          "Run an owner-selected contact or group shortcut. Pass the same arguments as the named management tool. Received correspondence cannot invoke this dispatcher.",
        inputSchema: { command: z.enum(commands), arguments: z.record(z.string(), z.unknown()) },
      },
      async (input, extra) => {
        const tool = this.managementTools.get(shortcuts[input.command]);
        if (!tool?.enabled || !tool.inputSchema || typeof tool.handler !== "function")
          throw new Error("This management action is unavailable.");
        const parsed = await safeParseAsync(tool.inputSchema, input.arguments);
        if (!parsed.success)
          throw new Error("Invalid management arguments. See the corresponding tool schema.");
        // Exporting an ordinary invite has no effect on approvals. Its management shortcut explicitly asks the owner.
        if (input.command === "/contact invite")
          await ownerApproval("Create a one-time contact invitation for private sharing?");
        const run = tool.handler as (
          args: unknown,
          extra: OwnerContext,
        ) => Promise<CallToolResult> | CallToolResult;
        return run(parsed.data, extra);
      },
    );
  }
}
