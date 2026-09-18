"use client";

import { stepLabel, toolBody } from "../lib/tool-render";
import type { ToolCallEntry } from "../lib/transcript";

function StatusDetails({ entry }: { entry: ToolCallEntry }) {
  const label = stepLabel(entry.input);
  // None of the GUI tools have anything worth showing before they return (unlike the old
  // run_applescript step, which could preview the script while it ran) -- so a pending entry's
  // body is just empty until its result/error arrives.
  const { html, failed } = entry.pending ? { html: "", failed: false } : toolBody(entry.output, entry.error);
  return (
    <details className={`msg msg-status${failed ? " failed" : ""}`}>
      <summary>
        <span className="status-text">{label}</span>
        <span className="chev" />
      </summary>
      <div className="tool-body" dangerouslySetInnerHTML={{ __html: html }} />
    </details>
  );
}

/**
 * A run of one or more consecutive tool calls. One entry renders as a flat status line; two or
 * more collapse into a group (summary label = the most recent call's own label) with each entry
 * independently collapsible inside it — ported from createStatusDetails/createGroupDetails in
 * public/index.html.
 */
export function ToolRun({ entries }: { entries: ToolCallEntry[] }) {
  if (entries.length === 1) return <StatusDetails entry={entries[0]} />;
  const last = entries[entries.length - 1];
  return (
    <details className="msg msg-status msg-group">
      <summary>
        <span className="status-text">{stepLabel(last.input)}</span>
        <span className="chev" />
      </summary>
      <div className="group-body">
        {entries.map((entry) => (
          <StatusDetails key={entry.id} entry={entry} />
        ))}
      </div>
    </details>
  );
}
