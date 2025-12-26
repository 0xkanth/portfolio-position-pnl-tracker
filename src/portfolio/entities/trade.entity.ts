export enum TradeSide {
  BUY = 'buy',
  SELL = 'sell',
}

// Trade execution record.
// System ingests historical trades and updates positions accordingly.
export interface Trade {
  id: string;                 // internal UUID
  tradeId: string;            // external ID from broker (idempotency key)
  orderId: string;            // order that generated this trade
  userId?: string;            // for multi-user systems
  symbol: string;             // BTC, ETH, etc.
  side: TradeSide;
  price: number;
  quantity: number;
  executionTimestamp: Date;
  createdAt?: Date;
}
