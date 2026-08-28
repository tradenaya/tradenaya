export interface OrderHistoryInsert {
  userId: number | null;
  userEmail: string | null;
  userCode: string | null;
  /** Futures exchange / sub-account reference the order was placed on (e.g. EXCHANGE_2). */
  exchange?: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  orderContext: "entry" | "stop_loss" | "take_profit" | "close_position";
  quantity: number | null;
  price: number | null;
  triggerPrice: number | null;
  reduceOnly: boolean;
  status: string;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  responseStatus: string | null;
  message: string | null;
  amountUsed: number | null;
  avgExecutionPrice: number | null;
  executionFee: number | null;
  pnl: number | null;
  realizedPnl: number | null;
  isProfit: boolean | null;
  rawResponse: string | null;
}

export interface OrderHistoryRow {
  id: number;
  userCode: string | null;
  exchange: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: string;
  orderContext: string;
  quantity: number | null;
  price: number | null;
  triggerPrice: number | null;
  reduceOnly: boolean;
  status: string;
  exchangeOrderId: string | null;
  clientOrderId: string | null;
  responseStatus: string | null;
  message: string | null;
  amountUsed: number | null;
  pnl: number | null;
  realizedPnl: number | null;
  isProfit: boolean | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderHistoryQuery {
  page: number;
  pageSize: number;
  search: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
