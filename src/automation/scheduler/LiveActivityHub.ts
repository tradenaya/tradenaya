/**
 * In-memory live telemetry hub for the automation engine.
 *
 * Granular algorithm steps are published here as they happen (per analysis
 * cycle) and streamed to connected dashboards over SSE. It is intentionally
 * ephemeral — the ring buffer is not persisted — so "live" always means what
 * the bot is doing right now, not history.
 */

export type AnalysisPhase =
  | "market"
  | "indicators"
  | "strategy"
  | "plan"
  | "risk"
  | "execution"
  | "lifecycle";

export interface LiveAnalysisStep {
  id: number;
  botId: number;
  userId: number;
  symbol: string;
  phase: AnalysisPhase;
  message: string;
  detail?: Record<string, unknown>;
  at: string;
}

type Listener = (step: LiveAnalysisStep) => void;

class LiveActivityHub {
  private buffer: LiveAnalysisStep[] = [];
  private listeners = new Set<Listener>();
  private nextId = Date.now();
  private readonly maxBuffer = 250;

  publish(step: Omit<LiveAnalysisStep, "id" | "at">): void {
    const full: LiveAnalysisStep = { ...step, id: this.nextId++, at: new Date().toISOString() };
    this.buffer.push(full);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    for (const listener of this.listeners) {
      try {
        listener(full);
      } catch {
        // A failing subscriber must never break the stream.
      }
    }
  }

  history(userId: number, limit = 120): LiveAnalysisStep[] {
    return this.buffer.filter((s) => s.userId === userId).slice(-limit);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Next.js dev compiles instrumentation.js (which starts the scheduler) and
// route handlers as separate module graphs, so a plain module-level singleton
// would be duplicated: the scheduler publishes to one copy while the SSE route
// subscribes to another — the trace then receives only keep-alive pings. Pin
// the hub to globalThis so every compiled copy shares the same instance. In
// production there is a single bundle, so this is harmless there.
const GLOBAL_KEY = "__tradenayaLiveActivityHub__";
const globalStore = globalThis as unknown as Record<string, LiveActivityHub | undefined>;

export const liveActivityHub: LiveActivityHub =
  globalStore[GLOBAL_KEY] ?? (globalStore[GLOBAL_KEY] = new LiveActivityHub());
