"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * High-level reasoning status steps.
 *
 * These are safe, generic status labels — NEVER raw chain-of-thought.
 * The backend may supply its own safe status strings via statusStates;
 * when it does, we render those instead of the defaults.
 */
const DEFAULT_STEPS = [
  "Thinking…",
  "Analyzing the request…",
  "Checking relevant context…",
  "Preparing response…",
];

interface ThinkingIndicatorProps {
  /** Optional safe status labels provided by the backend. */
  statuses?: string[];
  /** Which default step index is currently active. */
  activeIndex?: number;
}

export function ThinkingIndicator({
  statuses,
  activeIndex = 0,
}: ThinkingIndicatorProps) {
  const steps = useMemo(() => {
    if (statuses && statuses.length > 0) {
      return statuses.map((s) => (s.endsWith("…") ? s : `${s}…`));
    }
    return DEFAULT_STEPS;
  }, [statuses]);

  const [step, setStep] = useState(0);

  useEffect(() => {
    if (statuses && statuses.length > 0) {
      // Backend-driven: follow provided statuses, advancing one step at a time.
      setStep(Math.min(activeIndex, Math.max(0, steps.length - 1)));
      return;
    }

    // Default mode: cycle through safe statuses every 900ms.
    setStep(0);
    const timer = window.setInterval(() => {
      setStep((prev) => (prev + 1) % steps.length);
    }, 900);
    return () => window.clearInterval(timer);
  }, [steps, statuses, activeIndex]);

  return (
    <div className="thinking" role="status" aria-live="polite">
      <div className="thinking-header">
        <span className="thinking-spinner" aria-hidden="true" />
        <span>{steps[step] ?? "Working…"}</span>
      </div>
      <div className="thinking-steps" aria-hidden="true">
        {steps.map((label, i) => (
          <div
            key={label}
            className={`thinking-step${
              i < step ? " done" : i === step ? " active" : ""
            }`}
          >
            <span className="thinking-step-indicator" />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}