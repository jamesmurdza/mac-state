import { message } from "../../../lib/route-helpers";
import { resolveSandbox, toDescriptor, withSandbox, type SandboxDescriptor, type SandboxRef } from "../../../lib/sandbox-handle";
import { systemInfo } from "../../../lib/sandbox";

export const runtime = "nodejs";

/** Standard macOS system info (version, model, CPU/memory, hostname, uptime), read live over SSH. */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sandboxId = url.searchParams.get("sandboxId");
  const descriptor: SandboxDescriptor | undefined = sandboxId
    ? { sandboxId, host: url.searchParams.get("host") ?? "", vncUrl: url.searchParams.get("vncUrl") ?? "" }
    : undefined;
  try {
    const { handle } = await resolveSandbox(descriptor);
    const ref: SandboxRef = { current: handle };
    const info = await withSandbox(ref, (s) => systemInfo(s));
    // sandbox is additive: lets the client pick up a rotation triggered by this call too.
    return Response.json({ ...info, sandbox: toDescriptor(ref.current) });
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }
}
