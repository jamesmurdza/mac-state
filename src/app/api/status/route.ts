import { message } from "../../../lib/route-helpers";
import { resolveSandbox, type SandboxDescriptor } from "../../../lib/sandbox-handle";

export const runtime = "nodejs";

/**
 * Ensures a sandbox exists and returns its connection info: `{ sandboxId, host, vncUrl }`. With no
 * query params, always creates a fresh sandbox (today's "create on first load" behavior). With
 * `?sandboxId=&host=&vncUrl=` supplied (a client remounting/reconnecting), attaches to it instead —
 * zero network calls, no pointless churn — and only creates a new one once a real operation proves
 * the old one is gone. This route itself never proves liveness; it just describes intent.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const sandboxId = url.searchParams.get("sandboxId");
  const descriptor: SandboxDescriptor | undefined = sandboxId
    ? { sandboxId, host: url.searchParams.get("host") ?? "", vncUrl: url.searchParams.get("vncUrl") ?? "" }
    : undefined;
  try {
    const { descriptor: resolved } = await resolveSandbox(descriptor);
    return Response.json(resolved);
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }
}
