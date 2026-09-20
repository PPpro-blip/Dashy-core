/**
 * DashyCore v7 — Dashy Extensions: view action bridge.
 *
 * Some extension commands (e.g. "Agent Code: Apply Last Diff") need to reach
 * into a side panel that the host renders. Panels register named action
 * handlers on mount; extension command handlers fire them by name. If a
 * command fires before its panel mounted (the command usually opens the view
 * first), the action is queued and drained the moment the panel registers.
 *
 * This is intentionally tiny and framework-free so plain extension modules
 * can import it without pulling in React.
 */

type ActionHandler = () => void;

const handlers = new Map<string, ActionHandler>();
const queued = new Set<string>();

/** Panel registers a named action; returns an unsubscribe fn. */
export function onViewAction(key: string, fn: ActionHandler): () => void {
  handlers.set(key, fn);
  if (queued.has(key)) {
    queued.delete(key);
    try {
      fn();
    } catch (error) {
      console.error(`[dcode] view action ${key} failed`, error);
    }
  }
  return () => {
    if (handlers.get(key) === fn) handlers.delete(key);
  };
}

/** Extension fires a named action; queued if no panel is listening yet. */
export function fireViewAction(key: string): void {
  const fn = handlers.get(key);
  if (fn) {
    try {
      fn();
    } catch (error) {
      console.error(`[dcode] view action ${key} failed`, error);
    }
  } else {
    queued.add(key);
  }
}
