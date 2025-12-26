import Decimal from 'decimal.js';

// Realized P&L record from closed position with exact decimal arithmetic.
// Created when sell trade matches FIFO lots.
export interface RealizedPnlRecord {
  symbol: string;
  quantity: Decimal;
  buyPrice: Decimal;      // from FIFO lot
  sellPrice: Decimal;
  pnl: Decimal;           // (sellPrice - buyPrice) × quantity (exact)
  timestamp: Date;
}

// Pre-computed aggregate of realized P&L per symbol.
// Cached for O(1) reads with exact precision.
export type RealizedPnlAggregate = {
  totalPnl: Decimal;        // sum of all realized P&L
  totalQuantity: Decimal;   // total closed quantity
};
