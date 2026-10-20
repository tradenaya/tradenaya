import { Router } from "express";
import { z } from "zod";
import { clock, MINUTE } from "../lib/clock.js";
import { processSendQueue } from "../runs/send-queue.js";
import { h, parse, requireAuth } from "./common.js";

/**
 * End-to-end test helpers. Mounted ONLY when NODE_ENV=test and
 * MOCK_EXTERNAL=true (see app.ts), so they never exist in dev or production.
 */
export function testRouter() {
  const r = Router();
  r.use(requireAuth);
  // Move the server clock forward and run the send queue once per simulated minute.
  r.post(
    "/tick",
    h(async (req, res) => {
      const { minutes } = parse(z.object({ minutes: z.number().int().min(1).max(120) }), req.body);
      let sent = 0;
      for (let i = 0; i < minutes; i++) {
        clock.advance(MINUTE);
        sent += (await processSendQueue(clock.now(), () => 0)).sent;
      }
      res.json({ now: clock.now(), sent });
    }),
  );
  // Back to real time, so one test's fast-forward never leaks into the next.
  r.post("/reset-clock", (_req, res) => {
    clock.reset();
    res.json({ now: clock.now() });
  });
  return r;
}
