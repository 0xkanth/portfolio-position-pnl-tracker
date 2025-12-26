// Realized gains/losses from closed positions
export class RealizedPnlDto {
  symbol: string;
  realizedPnl: number;             // actual profit/loss
  closedQuantity: number;          // quantity sold
}

// Unrealized gains/losses from open positions
export class UnrealizedPnlDto {
  symbol: string;
  unrealizedPnl: number;           // paper profit/loss
  currentQuantity: number;         // still holding
  averageEntryPrice: number;
  currentPrice: number;
}

// Complete PnL breakdown
export class PnlResponseDto {
  realizedPnl: RealizedPnlDto[];
  unrealizedPnl: UnrealizedPnlDto[];
  totalRealizedPnl: number;        // all closed positions
  totalUnrealizedPnl: number;      // all open positions
  netPnl: number;                  // realized + unrealized
}
