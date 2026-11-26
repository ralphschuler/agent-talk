import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const checkout = fileURLToPath(new URL("../../", import.meta.url));
// Only these tools and their associated owner dialogs have been verified in Pi.
const tools = new Set([
  "adapter_status", "profile_export_invite", "contact_preview", "contact_confirm",
  "message_send", "inbox_list", "contact_block",
]);

// Literal escapes keep message text and pasted profile data inert in the terminal.
const printable = (text) => text.replace(/[\p{Cc}\p{Cf}]/gu,
  (char) => char.split("").map((unit) => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0")).join(""));

export default function agentTalk(pi) {
  pi.registerFlag("agent-talk-relay", { type: "string", description: "Trusted Agent Talk relay origin" });
  pi.registerFlag("agent-talk-state", { type: "string", description: "Absolute private state file for this Pi identity" });
  let client;
  let ownerAction;

  async function call(name, args, signal) {
    if (!tools.has(name)) throw new Error("Unknown Agent Talk tool.");
    if (!client) throw new Error("Agent Talk is disconnected. Check the relay, state path and Node version, then restart Pi.");
    const needsOwner = name === "contact_confirm" || name === "contact_block";
    if (needsOwner) {
      if (ownerAction) throw new Error("Another owner decision is already pending.");
      const agentId = name === "contact_confirm" ? JSON.parse(args.invite)?.issuer?.agentId : args.agentId;
      ownerAction = { name, agentId, prompted: false };
    }
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 120000 });
      const text = result.content.find((item) => item.type === "text")?.text;
      if (result.isError || typeof text !== "string") throw new Error(printable(text ?? "Agent Talk request failed."));
      return JSON.parse(text);
    } finally { if (needsOwner) ownerAction = undefined; }
  }

  pi.on("session_start", async (_event, ctx) => {
    const relay = pi.getFlag("agent-talk-relay");
    const state = pi.getFlag("agent-talk-state");
    if (process.versions.bun || !relay || !state || !isAbsolute(state))
      throw new Error("Use Node-based Pi and supply --agent-talk-relay and an absolute --agent-talk-state.");

    const connection = new Client({ name: "agent-talk-pi", version: "1" }, { capabilities: { elicitation: { form: {} } } });
    connection.setRequestHandler(ElicitRequestSchema, async ({ params }, { signal }) => {
      const action = ownerAction;
      if (!action || action.prompted || signal.aborted || ctx.mode !== "tui" || !ctx.hasUI || params.mode === "url")
        return { action: "decline" };
      const field = params.requestedSchema?.properties?.approve;
      if (field?.type !== "boolean" || field.default !== false || field.title !== params.message)
        return { action: "decline" };
      const confirm = /^Confirm contact (at1_[A-Za-z0-9_-]{43}) at ([^\s?]+)\? Compare this fingerprint privately: ([0-9a-f]{64})$/u.exec(params.message);
      const block = /^Block contact (at1_[A-Za-z0-9_-]{43})\?$/u.exec(params.message);
      if (action.name === "contact_confirm"
        ? !confirm || confirm[1] !== action.agentId || confirm[2] !== new URL(relay).origin
        : !block || block[1] !== action.agentId) return { action: "decline" };
      const prompt = confirm
        ? ["Confirm Agent Talk contact", "Agent ID  " + confirm[1], "Relay  " + confirm[2],
           "Compare this fingerprint privately", confirm[3]].join("\n")
        : "Block Agent Talk contact\n" + block[1];
      action.prompted = true;
      const answer = await ctx.ui.select(prompt, ["Decline", "Approve"], { signal });
      return answer === "Approve" && ownerAction === action && !signal.aborted
        ? { action: "accept", content: { approve: true } } : { action: "decline" };
    });

    const transport = new StdioClientTransport({
      command: process.execPath, cwd: checkout, stderr: "ignore",
      args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", state],
    });
    try {
      await connection.connect(transport, { timeout: 30000 });
      const list = await connection.listTools();
      for (const tool of list.tools.filter((entry) => tools.has(entry.name))) {
        pi.registerTool({
          name: "agent_talk_" + tool.name, label: "Agent Talk · " + tool.name,
          description: tool.description, parameters: tool.inputSchema,
          async execute(_id, args, signal) {
            const data = await call(tool.name, args, signal);
            return { content: [{ type: "text", text: printable(JSON.stringify(data)) }], details: {} };
          },
        });
      }
      client = connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  });
  pi.on("session_shutdown", async () => {
    const old = client;
    client = undefined;
    await old?.close();
  });
}
