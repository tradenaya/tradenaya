import { getKeysForUser } from "@/lib/coinswitch.store";
import { coinswitchClient, CoinSwitchClient } from "@/automation/executor/client";
import { orderExecutor, OrderExecutorService, maxSafeAllocationPct, MARGIN_HEADROOM, MARGIN_FEE_BUFFER } from "@/automation/executor/order-executor";
import { AutomationEngine } from "@/automation/engine/automation-engine";
import { serverMarketDataService } from "@/automation/market/service";
import { DefaultRiskManager } from "@/automation/risk/risk-manager";
import { BotLifecycleService, type BotRuntimeState } from "@/automation/service/bot-lifecycle";
import type { AutomationConfig } from "@/automation/types";
import { SchedulerStore } from "./SchedulerStore";
import { SchedulerLock } from "./SchedulerLock";
import { SchedulerStateManager } from "./SchedulerStateManager";
import { SchedulerEventBus } from "./SchedulerEventBus";
import { SchedulerRecovery } from "./SchedulerRecovery";
import { AnalysisCycleRunner } from "./AnalysisCycleRunner";
import { DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig, type SchedulerState } from "./SchedulerTypes";

export interface BotSchedulerDependencies {
  config?: SchedulerConfig;
  lifecycle?: BotLifecycleService;
  client?: CoinSwitchClient;
  executor?: OrderExecutorService;
  riskManager?: DefaultRiskManager;
  store?: SchedulerStore;
  events?: SchedulerEventBus;
  stateManager?: SchedulerStateManager;
}

export class BotScheduler {
  private readonly config: Required<SchedulerConfig>;
  private readonly lifecycle: BotLifecycleService;
  private readonly store: SchedulerStore;
  private readonly lock: SchedulerLock;
  private readonly stateManager: SchedulerStateManager;
  private readonly events: SchedulerEventBus;
  private readonly recovery: SchedulerRecovery;
  private readonly cycles: AnalysisCycleRunner;
  private readonly inProcess = new Set<number>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(deps: BotSchedulerDependencies = {}) {
    this.config = { ...DEFAULT_SCHEDULER_CONFIG, ...deps.config };
    this.lifecycle = deps.lifecycle ?? new BotLifecycleService();
    const client = deps.client ?? coinswitchClient;
    const store = deps.store ?? new SchedulerStore({ lifecycle: this.lifecycle });
    this.store = store;
    this.events = deps.events ?? new SchedulerEventBus((event) => store.saveEvent(event));
    this.stateManager = deps.stateManager ?? new SchedulerStateManager(this.lifecycle);
    this.lock = new SchedulerLock(this.lifecycle, this.config.leaseTtlSeconds);
    this.cycles = new AnalysisCycleRunner({
      store,
      stateManager: this.stateManager,
      events: this.events,
      lifecycle: this.lifecycle,
      client,
      engine: (userId) => new AutomationEngine(serverMarketDataService.adapterFor(userId)),
      riskManager: deps.riskManager ?? new DefaultRiskManager(),
      executor: deps.executor ?? orderExecutor,
      config: this.config,
      refreshLease: (botId) => this.lock.refresh(botId),
    });
    this.recovery = new SchedulerRecovery({ store, stateManager: this.stateManager, events: this.events, lifecycle: this.lifecycle, client, cycles: this.cycles });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Start ticking first so a failure below (schema, market data, recovery)
    // can never leave the scheduler permanently dead.
    this.timer = setInterval(
      () => void this.tick().catch((error) => console.error("BotScheduler: tick error", error)),
      this.config.tickIntervalMs,
    );
    try {
      await this.lifecycle.ensureSchedulerSchema();
      await this.store.ensureEventsTable();
      await serverMarketDataService.start();
      await this.recoverAll();
    } catch (error) {
      console.error("BotScheduler: startup failed; continuing to tick in background", error);
    }
    await this.tick().catch((error) => console.error("BotScheduler: initial tick error", error));
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void serverMarketDataService.stop();
    // Shutdown must NEVER close an open position or cancel SL/TP orders on the
    // exchange. Exchange-side protective orders remain active independently of
    // this server.
    console.log("[SHUTDOWN] BotScheduler stopped — NO position close / order cancel performed. Exchange-side SL/TP remain active.");
  }

  /**
   * Revives the scheduler if it was never started (e.g. the module was hot
   * reloaded in dev but instrumentation.register() did not re-run).
   */
  async ensureStarted(): Promise<void> {
    if (!this.started) await this.start();
  }

  isRunning(): boolean {
    return this.started && this.timer !== null;
  }

  async recoverAll(): Promise<void> {
    await this.recovery.recoverAll();
  }

  async tick(): Promise<void> {
    if (!this.started) return;
    const bots = await this.lifecycle.getSchedulableBots();
    for (const bot of bots) {
      if (this.inProcess.has(bot.id)) continue;
      const acquired = await this.lock.acquire(bot.id);
      if (!acquired) continue;
      this.inProcess.add(bot.id);
      await this.events.emit({ type: "LOCK_ACQUIRED", botId: bot.id, userId: bot.userId, message: `Lease acquired for bot ${bot.id}` });
      void this.runBotCycle(bot).finally(() => {
        this.inProcess.delete(bot.id);
        void this.lock
          .release(bot.id)
          .then(() => this.events.emit({ type: "LOCK_RELEASED", botId: bot.id, userId: bot.userId, message: `Lease released for bot ${bot.id}` }))
          .catch((error) => console.error(`BotScheduler: failed to release lease for bot ${bot.id}`, error));
      });
    }
  }

  private async runBotCycle(bot: BotRuntimeState): Promise<void> {
    try {
      await this.cycles.runCycle(bot.id);
    } catch (error) {
      console.error(`BotScheduler: unexpected error in cycle for bot ${bot.id}`, error);
      const fresh = await this.store.getBot(bot.id).catch(() => null);
      if (fresh) await this.cycles.handleCycleError(fresh, error);
    }
  }

  async listBots(userId: number): Promise<BotRuntimeState[]> {
    return this.lifecycle.listBotsByUser(userId);
  }

  async getBot(userId: number, botId: number): Promise<BotRuntimeState | null> {
    return this.lifecycle.getBotByUserAndId(userId, botId);
  }

  async updateConfig(userId: number, botId: number, config: AutomationConfig): Promise<BotRuntimeState> {
    const bot = await this.lifecycle.getBotByUserAndId(userId, botId);
    if (!bot) throw new Error("Bot not found");
    this.validateConfig(config);
    if ((bot.desiredStatus ?? "STOPPED") === "RUNNING") {
      throw new Error("Pause or stop the bot before changing its configuration.");
    }
    await this.lifecycle.updateConfig(botId, {
      leverage: config.leverage,
      capital: config.capital,
      capitalMode: config.capitalMode,
      walletPercent: config.walletPercent,
      configJson: JSON.stringify(config),
    });
    await this.events.emit({ type: "BOT_CONFIG_UPDATED", botId, userId, message: `Bot ${botId} configuration updated` });
    const updated = await this.lifecycle.getBotById(botId);
    if (!updated) throw new Error("Bot not found after update");
    return updated;
  }

  async deleteBot(userId: number, botId: number): Promise<boolean> {
    const bot = await this.lifecycle.getBotByUserAndId(userId, botId);
    if (!bot) throw new Error("Bot not found");
    if ((bot.desiredStatus ?? "STOPPED") === "RUNNING") {
      throw new Error("Stop the bot before deleting it.");
    }
    if (await this.store.hasActiveTradeForBot(botId)) {
      throw new Error("Cannot delete a bot while it has an active trade. Wait for the position to close first.");
    }
    await this.lifecycle.releaseLease(botId, this.lock.owner).catch(() => false);
    return this.lifecycle.deleteBot(botId);
  }

  async startBot(userId: number, config: AutomationConfig): Promise<{ botId: number }> {
    await this.ensureStarted();
    const keys = await getKeysForUser(userId);
    if (!keys || keys.status !== "A") {
      throw new Error("CoinSwitch credentials are missing or inactive. Please reconnect your CoinSwitch account.");
    }
    this.validateConfig(config);

    await this.validateLiveConstraints(userId, config);

    const botId = await this.lifecycle.createBot({
      userId,
      symbol: config.symbol,
      strategy: "TradiAuraSmartV1",
      leverage: config.leverage,
      capital: config.capital,
      capitalMode: config.capitalMode,
      walletPercent: config.walletPercent,
      status: "STOPPED",
    });
    await this.lifecycle.setConfig(botId, JSON.stringify(config));
    await this.lifecycle.updateDesiredStatus(botId, "RUNNING");
    await this.lifecycle.setRetryCount(botId, 0);
    await this.lifecycle.setRuntimeError(botId, null);
    await this.lifecycle.updateHeartbeatAt(botId);
    await this.lifecycle.scheduleNextRun(botId, new Date());
    await this.events.emit({ type: "BOT_STARTED", botId, userId, message: `Bot started for ${config.symbol}` });

    const bot = await this.lifecycle.getBotById(botId);
    if (bot) {
      if (this.started) {
        await this.recovery.recoverBot(bot);
      } else {
        await this.stateManager.transition(bot.id, "STOPPED", "STARTING");
        await this.stateManager.transition(bot.id, "STARTING", "RUNNING");
      }
    }
    return { botId };
  }

  async stopBot(userId: number, botId: number): Promise<void> {
    const bot = await this.lifecycle.getBotByUserAndId(userId, botId);
    if (!bot) throw new Error("Bot not found");
    await this.lifecycle.updateDesiredStatus(botId, "STOPPED");
    await this.lock.release(botId).catch(() => {});
    const active = await this.store.hasActiveTradeForBot(botId);
    const from = this.asState(bot.status);
    if (active) {
      await this.stateManager.transition(bot.id, from, "STOPPED");
    } else {
      await this.stateManager.transition(bot.id, from, "STOPPING");
      await this.stateManager.transition(bot.id, "STOPPING", "STOPPED");
    }
    await this.lifecycle.setRuntimeError(botId, null);
    await this.events.emit({ type: "BOT_STOPPED", botId, userId, message: "Bot stopped; no new trades will be created" });
  }

  async pauseBot(userId: number, botId: number): Promise<void> {
    const bot = await this.lifecycle.getBotByUserAndId(userId, botId);
    if (!bot) throw new Error("Bot not found");
    await this.lifecycle.updateDesiredStatus(botId, "PAUSED");
    await this.lock.release(botId).catch(() => {});
    const active = await this.store.hasActiveTradeForBot(botId);
    await this.stateManager.transition(bot.id, this.asState(bot.status), active ? "POSITION_MANAGED" : "PAUSED");
    await this.events.emit({ type: "BOT_PAUSED", botId, userId, message: "Bot paused" });
  }

  async resumeBot(userId: number, botId: number): Promise<void> {
    await this.ensureStarted();
    const bot = await this.lifecycle.getBotByUserAndId(userId, botId);
    if (!bot) throw new Error("Bot not found");
    await this.lifecycle.updateDesiredStatus(botId, "RUNNING");
    await this.lifecycle.setRetryCount(botId, 0);
    await this.lifecycle.setRuntimeError(botId, null);
    await this.events.emit({ type: "BOT_RESUMED", botId, userId, message: "Bot resumed" });
    const fresh = await this.lifecycle.getBotById(botId);
    if (fresh) await this.recovery.recoverBot(fresh);
  }

  private validateConfig(config: AutomationConfig): void {
    if (!config.symbol) throw new Error("Trading symbol is required");
    if (!config.timeframe) throw new Error("Trading timeframe is required");
    if (!(config.leverage > 0)) throw new Error("Leverage must be greater than zero");
    if (!(config.capital > 0)) throw new Error("Capital must be greater than zero");
    if (!(config.maxRiskPerTrade > 0)) throw new Error("Max risk per trade must be greater than zero");
    if (config.dailyLossLimit == null) throw new Error("Daily loss limit is required");
    if (config.capitalMode === "percent" && (config.walletPercent ?? 0) <= 0) {
      throw new Error("Wallet percent must be greater than zero when using percentage-based capital");
    }
    if (config.capitalMode === "percent" && (config.walletPercent ?? 0) > 100) {
      throw new Error("Wallet percent cannot exceed 100%");
    }
  }

  /** Fetch live wallet balance + instrument rules and reject if the bot cannot actually trade. */
  private async validateLiveConstraints(userId: number, config: AutomationConfig): Promise<void> {
    const [balance, instrument] = await Promise.all([
      coinswitchClient.getWalletBalance(userId).catch(() => null),
      coinswitchClient.getInstrumentInfo(userId, config.symbol).catch(() => null),
    ]);

    if (balance == null) {
      throw new Error(
        "Could not verify your futures wallet balance. Make sure your CoinSwitch account is connected and has USDT available.",
      );
    }

    const allocated =
      config.capitalMode === "percent"
        ? balance * ((Number(config.walletPercent) || 0) / 100)
        : Number(config.capital) || 0;

    if (!(allocated > 0)) {
      throw new Error("Allocated capital must be greater than zero.");
    }

    if (balance <= 0) {
      throw new Error(
        "Your futures available balance is 0 USDT. Set aside USDT in your CoinSwitch futures wallet (free, not locked in positions/orders) before starting a bot.",
      );
    }

    // Tiny floating-point excess at exactly 100% allocation must not be reported
    // as insufficient. Only block when the allocation really exceeds the balance.
    const EXCESS_TOLERANCE = 1e-9;
    if (allocated - balance > EXCESS_TOLERANCE) {
      throw new Error(
        `Insufficient wallet balance. You need ${allocated.toFixed(2)} USDT but your available futures balance is ${balance.toFixed(2)} USDT (${(balance - allocated).toFixed(2)} USDT short). Reduce your capital allocation or set aside more USDT as free (unlocked) balance.`,
      );
    }

    // High-allocation guard: the order's margin (notional / leverage) scales
    // with the allocated capital, so at ~100% allocation it consumes the entire
    // available balance with zero headroom. The exchange then rejects with a
    // cryptic "Insufficient balance" over a few cents of fees/rounding. Block
    // up front so the user is told the safe allocation instead of seeing a
    // confusing runtime failure.
    const headroom = MARGIN_HEADROOM;
    if (allocated > balance * (1 - headroom) + MARGIN_FEE_BUFFER + EXCESS_TOLERANCE) {
      const safePct = maxSafeAllocationPct(balance, headroom, MARGIN_FEE_BUFFER);
      throw new Error(
        `Leaving no headroom at ${config.capitalMode === "percent" ? `${config.walletPercent}%` : `$${allocated.toFixed(2)}`} allocation. ` +
        `The order margin would consume nearly all of your ${balance.toFixed(2)} USDT free balance, which the exchange rejects (` +
        `"Insufficient balance") once fees/rounding push it over. Reduce the allocation to ~${safePct.toFixed(0)}% of the available balance ` +
        `(or lower leverage) so the order does not use up the whole free balance.`,
      );
    }

    if (instrument) {
      // `status` is a market-wide flag from the exchange (TRADING = market is
      // open to everyone). It does NOT reflect whether this account's API key
      // is associated with a futures subaccount for the symbol — CoinSwitch
      // reports that separately at order time ("subaccount association not
      // found"). So we only block clearly closed markets here.
      const status = String(instrument.status ?? "").toUpperCase();
      if (status && status !== "TRADING") {
        throw new Error(
          `${config.symbol} futures market is not open for trading (status: ${status}). Pick a different market.`,
        );
      }

      const minLeverage = Number(instrument.min_leverage);
      const maxLeverage = Number(instrument.max_leverage);
      if (Number.isFinite(minLeverage) && Number.isFinite(maxLeverage) && maxLeverage > 0) {
        if (config.leverage < minLeverage || config.leverage > maxLeverage) {
          throw new Error(
            `Leverage ${config.leverage}x is outside the allowed range (${minLeverage}x - ${maxLeverage}x) for ${config.symbol}.`,
          );
        }
      }

      // Reject configs that can never meet the exchange's minimum order size.
      // Even the maximum position the capital can open (capital * leverage) is
      // below the min base quantity, so the bot would sit in "ENTRY_CANCELLED"
      // forever instead of trading.
      const minQty = Number(instrument.min_base_quantity);
      if (Number.isFinite(minQty) && minQty > 0) {
        const step = Number(instrument.base_quantity_step_size ?? instrument.lot_size ?? NaN);
        const price = await coinswitchClient.getCurrentPrice(userId, config.symbol).catch(() => null);
        if (price != null && price > 0) {
          const maxPosition = (allocated * config.leverage) / price;
          const floored = Number.isFinite(step) && step > 0 ? Math.floor(maxPosition / step) * step : maxPosition;
          if (floored < minQty) {
            const minNotional = minQty * price;
            const requiredCapital = minNotional / config.leverage;
            throw new Error(
              `Allocated capital of ${allocated.toFixed(4)} USDT at ${config.leverage}x cannot buy the minimum order for ${config.symbol} — minimum is ${minQty} ${config.symbol} (~${minNotional.toFixed(4)} USDT). Raise capital to at least ${requiredCapital.toFixed(4)} USDT or increase leverage.`,
            );
          }

          // Risk compatibility check: verify that the estimated SL loss
          // does not exceed the user's max risk allocation.
          const maxRiskPct = Number(config.maxRiskPerTrade) || 0;
          if (maxRiskPct > 0 && allocated > 0) {
            const maxRiskUsdt = allocated * (maxRiskPct / 100);
            // Mirror stop-loss-planner: baseDistance = max(atr*1.35, price*minStopDistancePct*1.01)
            const minStopDistancePct = 0.008;
            const estimatedAtr = price * 0.01;
            const slDistance = Math.max(estimatedAtr * 1.35, price * minStopDistancePct * 1.01);
            const positionNotional = allocated * config.leverage;
            const capitalCappedSize = positionNotional / price;
            const riskBasedSize = maxRiskUsdt / slDistance;
            const positionSize = Math.min(riskBasedSize, capitalCappedSize);
            const expectedLoss = slDistance * positionSize;

            if (expectedLoss > maxRiskUsdt * 1.01) {
              throw new Error(
                `Configuration exceeds maximum risk. The estimated SL loss (~${expectedLoss.toFixed(2)} USDT) exceeds your max risk limit of ${maxRiskUsdt.toFixed(2)} USDT. Reduce capital allocation, increase max risk %, or let the bot's dynamic SL adapt at runtime.`,
              );
            }
          }
        }
      }
    }
  }

  private asState(status: BotRuntimeState["status"]): SchedulerState {
    return status as SchedulerState;
  }
}

export const botScheduler = new BotScheduler();
