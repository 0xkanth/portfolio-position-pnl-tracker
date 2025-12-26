import Decimal from 'decimal.js';

// Record of realized P&L from a closed position.
// Created when a sell trade matches FIFO lots.
export interface RealizedPnlRecord {
  symbol: string;
  quantity: Decimal;
  buyPrice: Decimal;      // from FIFO lot
  sellPrice: Decimal;
  pnl: Decimal;           // (sellPrice - buyPrice) × quantity
  timestamp: Date;
}

// Pre-computed aggregate of realized P&L for a symbol.
// Cached for O(1) reads instead of summing all records.
export type RealizedPnlAggregate = {
  totalPnl: Decimal;        // sum of all realized P&L
  totalQuantity: Decimal;   // total closed quantity
};
