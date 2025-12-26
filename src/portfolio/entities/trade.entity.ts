import Decimal from 'decimal.js';

export enum TradeSide {
  BUY = 'buy',
  SELL = 'sell',
}

// Trade execution record with Decimal precision for financial values.
// System ingests trades and updates positions with exact arithmetic.
export interface Trade {
  id: string;                 // internal UUID
  tradeId: string;            // external ID from broker (idempotency key)
  orderId: string;            // order that generated this trade
  userId?: string;            // for multi-user systems
  symbol: string;             // BTC, ETH, etc.
  side: TradeSide;
  price: Decimal;             // execution price with 20 sig digits precision
  quantity: Decimal;          // amount traded with exact precision
  executionTimestamp: Date;
  createdAt?: Date;
}
