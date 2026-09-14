import { describe, expect, it } from "vitest";
import { pollUntil, sleep, snap, uiApp, useSandbox } from "./helpers.js";

const SCENARIO = "gui-dialog";
const SCRIPT_PATH = "/tmp/mac-state-dialog.applescript";
const OUT_PATH = "/tmp/mac-state-dialog.out";
const SCRIPT = `
display dialog "hello from mac-state" buttons {"OK"} default button 1 giving up after 12
return "done"
`;

describe("Modal dialog: display dialog from an SSH-run script shows on screen", () => {
  const sandbox = useSandbox();

  it("the dialog is on screen while the script blocks, then gives up on its own", async () => {
    const mac = sandbox();
    await snap(mac, SCENARIO, "before");

    // Detached: osascript blocks until the dialog closes, so run it in the background and keep its pid.
    await mac.upload(new TextEncoder().encode(SCRIPT), SCRIPT_PATH);
    const started = await mac.execSsh(`nohup osascript ${SCRIPT_PATH} > ${OUT_PATH} 2>&1 & echo $!`);
    const pid = Number(started.stdout.trim());
    expect(pid).toBeGreaterThan(0);
    await sleep(1_500);

    const during = await uiApp(mac, pid);
    expect(during?.info.name).toBe("osascript");
    expect(during?.windows).toHaveLength(1);
    await snap(mac, SCENARIO, "during");

    const out = await pollUntil(() => mac.execSsh(`cat ${OUT_PATH}`), (r) => r.stdout.includes("done"), 20_000, 2_000);
    expect(out.stdout.trim()).toBe("done");
    expect(await uiApp(mac, pid)).toBeUndefined();
    expect((await mac.execSsh(`kill -0 ${pid}`)).exitCode).not.toBe(0);
    await snap(mac, SCENARIO, "after");
  });
});
