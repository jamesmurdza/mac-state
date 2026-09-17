import { runAgent } from "../../../lib/agent";
import { historyField, message, modelField, sandboxField, textField } from "../../../lib/route-helpers";
import { resolveSandbox, toDescriptor, withSandbox, type SandboxRef } from "../../../lib/sandbox-handle";
import { runAppleScript } from "../../../lib/sandbox";

export const runtime = "nodejs";

/** What /api/run reports as the author when the caller sent the script itself. */
export const RAW_SCRIPT_MODEL = "none (script sent as-is)";

/**
 * Body is either `{ prompt, model, sandbox?, history? }` (the agent inspects the screen and runs
 * scripts until the instruction is done) or `{ script, sandbox? }` (run that script once, as-is,
 * with no model in the loop). Both return `{ model, steps, reply, sandbox }`; the agent path also
 * returns the full updated `history` — this server holds none of that between requests, so the
 * caller is responsible for resending `sandbox`/`history` on the next call.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const prompt = textField(body, "prompt");
  const script = textField(body, "script");
  if (!prompt && !script) return Response.json({ error: "prompt or script is required" }, { status: 400 });

  try {
    const { handle } = await resolveSandbox(sandboxField(body));
    const ref: SandboxRef = { current: handle };

    if (script) {
      const result = await withSandbox(ref, (s) => runAppleScript(s, script));
      const reply =
        result.exitCode === 0
          ? result.stdout.trim() || "Done."
          : result.stderr.trim() || `Script failed (exit ${result.exitCode})`;
      return Response.json({
        model: RAW_SCRIPT_MODEL,
        steps: [{ tool: "run_applescript", input: { script }, output: result }],
        reply,
        sandbox: toDescriptor(ref.current),
      });
    }

    try {
      const result = await runAgent({ prompt, modelChoice: modelField(body), sandboxRef: ref, history: historyField(body) });
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: `Claude: ${message(err)}` }, { status: 502 });
    }
  } catch (err) {
    return Response.json({ error: message(err) }, { status: 500 });
  }
}
