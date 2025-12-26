// Current market prices for all tracked symbols
export class MarketPricesResponseDto {
  prices: Record<string, number>;  // { "BTC": 50000, "ETH": 3000 }
  lastUpdated: string;             // ISO timestamp
  source: string;                  // "internal" or "external"
}
