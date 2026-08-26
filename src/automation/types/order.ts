export interface OrderPlan {
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  leverage: number;
  riskReward: number;
}

export interface OrderExecutionResult {
  success: boolean;
  orderId?: string;
  status: string;
  message?: string;
}
