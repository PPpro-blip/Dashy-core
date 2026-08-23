"use client";

import { useEffect, useState } from "react";

/**
 * Agent Activity timeline — live progress feed.
 * Default pipeline: 🧠 Planning → 🔎 Memory Search → ✅ Complete.
 * Backend-provided `activity` labels override the defaults when present.
 */

const DEFAULT_STEPS = ["🧠 Planning", "🔎 Memory Search", "✅ Complete"];

interface AgentActivityProps {
  /** Safe, high-level activity labels from the backend. */
  steps?: string[];
  /** Whether the agent is still running (animates the active step). */
  active: boolean;
}

export function AgentActivity({ steps, active }: AgentActivityProps) {
  const items = steps && steps.length > 0 ? steps : DEFAULT_STEPS;
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) {
      // Snap to complete when finished.
      setProgress(items.length - 1);
      return;
    }
    setProgress(0);
    const timer = window.setInterval(() => {
      setProgress((prev) => Math.min(prev + 1, items.length - 1));
    }, 1100);
    return () => window.clearInterval(timer);
  }, [active, items.length]);

  return (
    <div className="agent-activity" role="status" aria-live="polite">
      <div className="agent-activity-header">
        <span className="thinking-spinner" aria-hidden="true" />
        <span>Agent Activity</span>
      </div>
      <div className="agent-activity-steps">
        {items.map((label, i) => (
          <div key={`${label}-${i}`}>
            <div
              className={`agent-step${
                i === progress && active ? " active" : i < progress || !active ? " done" : ""
              }`}
            >
              <span className="agent-step-icon" aria-hidden="true">{label.split(" ")[0]}</span>
              <span>{label.replace(/^\S+\s*/, "")}</span>
            </div>
            {i < items.length - 1 && <div className="agent-step-line" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </div>
  );
}