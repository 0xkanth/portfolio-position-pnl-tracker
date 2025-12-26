// Response after recording a trade
export class TradeResponseDto {
  id: string;                     // internal ID
  tradeId: string;                // broker trade ID
  orderId: string;
  symbol: string;
  side: string;
  price: number;
  quantity: number;
  executionTimestamp: string;
  createdAt?: string;
  message: string;
  duplicate: boolean;             // true if trade was already recorded
}
