import { NextRequest } from "next/server";
import { liveActivityHub, type LiveAnalysisStep } from "@/automation/scheduler/LiveActivityHub";
import { requireUserId } from "../_helpers";
import { currentTradingMode, tradingModeOfBot, type TradingMode } from "@/automation/paper/mode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = requireUserId(req);
  // EventSource can't send headers, so the Paper view connects with ?mode=PAPER.
  const viewMode = currentTradingMode();
  const botModes = new Map<number, TradingMode>();
  const modeOf = async (botId: number | null | undefined): Promise<TradingMode> => {
    if (!botId) return "LIVE";
    if (!botModes.has(botId)) botModes.set(botId, await tradingModeOfBot(botId));
    return botModes.get(botId) as TradingMode;
  };

  const url = new URL(req.url);
  const botIdParam = url.searchParams.get("botId");
  const botId = botIdParam ? Number(botIdParam) : undefined;
  const botIdValid = botId == null || !Number.isFinite(botId) ? undefined : botId;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (step: LiveAnalysisStep) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(step)}\n\n`));
        } catch {
          cleanup();
        }
      };

      // SSE cannot carry HTTP status codes, so an unauthenticated connection still
      // opens (HTTP 200) and immediately sends an "auth" frame. This prevents
      // EventSource from seeing a hard 401 (which it treats as a fatal error and
      // never retries usefully) and lets the client surface a login prompt.
      if (!userId) {
        send({ id: -1, userId: 0, botId: 0, symbol: "", phase: "lifecycle", message: "auth_required", at: new Date().toISOString() });
        // Keep the stream alive briefly so the client receives the frame, then close.
        setTimeout(() => {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }, 500);
        return;
      }

      // Replay recent history so the UI is populated immediately on connect.
      for (const step of liveActivityHub.history(userId)) {
        if (botIdValid != null && step.botId !== botIdValid) continue;
        if ((await modeOf(step.botId)) !== viewMode) continue;
        send(step);
      }

      const unsubscribe = liveActivityHub.subscribe((step) => {
        if (step.userId !== userId) return;
        if (botIdValid != null && step.botId !== botIdValid) return;
        void modeOf(step.botId).then((mode) => {
          if (mode === viewMode) send(step);
        });
      });

      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      }

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
