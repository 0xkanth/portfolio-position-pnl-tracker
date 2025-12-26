// Current position for a single symbol
export class PositionDto {
  symbol: string;
  totalQuantity: number;
  averageEntryPrice: number;       // weighted average
  currentValue: number;            // quantity * current price
  unrealizedPnl: number;
}

// Complete portfolio snapshot
export class PortfolioResponseDto {
  positions: PositionDto[];
  totalValue: number;              // sum of all position values
  totalUnrealizedPnl: number;      // sum of all unrealized PnL
}
