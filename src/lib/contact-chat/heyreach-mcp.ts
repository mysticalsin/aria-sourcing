/**
 * Fake HeyReach MCP transport.
 * There is no live client: this module never calls fetch and has no HeyReach host.
 */

export interface HeyReachMcpArgs {
  personId: string;
  text: string;
}

export interface HeyReachMcpContext {
  tokenPresent: boolean;
}

export interface HeyReachMcpTransport {
  call(tool: "send_message", args: HeyReachMcpArgs, context: HeyReachMcpContext): Promise<{ id: string }>;
}

export interface HeyReachMcpCall {
  tool: "send_message";
  personId: string;
  text: string;
  tokenPresent: boolean;
}

export function createFakeHeyReachMcp(): { calls: HeyReachMcpCall[]; transport: HeyReachMcpTransport } {
  const calls: HeyReachMcpCall[] = [];
  const transport: HeyReachMcpTransport = {
    async call(tool, args, context) {
      if (tool !== "send_message") {
        throw new Error("HeyReach MCP fake only implements send_message.");
      }
      const record: HeyReachMcpCall = {
        tool,
        personId: args.personId,
        text: args.text,
        tokenPresent: context.tokenPresent,
      };
      calls.push(record);
      return { id: `fake-mcp-${calls.length}` };
    },
  };
  return { calls, transport };
}

const demo = createFakeHeyReachMcp();

export function demoHeyReachTransport(): HeyReachMcpTransport {
  return demo.transport;
}
