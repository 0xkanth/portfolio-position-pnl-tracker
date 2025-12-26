// Record of realized P&L from a closed position.
// Created when a sell trade matches FIFO lots.
export interface RealizedPnlRecord {
  symbol: string;
  quantity: number;
  buyPrice: number;      // from FIFO lot
  sellPrice: number;
  pnl: number;           // (sellPrice - buyPrice) × quantity
  timestamp: Date;
}

// Pre-computed aggregate of realized P&L for a symbol.
// Cached for O(1) reads instead of summing all records.
export type RealizedPnlAggregate = {
  totalPnl: number;        // sum of all realized P&L
  totalQuantity: number;   // total closed quantity
};
