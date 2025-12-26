import Decimal from 'decimal.js';

// FIFO lot - tracks buy lot with exact cost basis.
export interface FifoLot {
  quantity: Decimal;
  price: Decimal;         // cost basis
  tradeId: string;
}

// Current holdings per symbol with Decimal precision.
// FIFO queue maintains lot-level tracking for accurate P&L.
export interface Position {
  symbol: string;
  fifoQueue: FifoLot[];        // oldest first
  totalQuantity: Decimal;       // cached sum
  averageEntryPrice: Decimal;   // weighted average
}
