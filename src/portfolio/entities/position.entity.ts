// FIFO lot - tracks a single buy lot with its cost basis.
export interface FifoLot {
  quantity: number;
  price: number;         // cost basis
  tradeId: string;
}

// Current holdings for a symbol.
// Maintains FIFO queue for sell matching and cost basis calculation.
export interface Position {
  symbol: string;
  fifoQueue: FifoLot[];        // oldest first
  totalQuantity: number;       // cached sum
  averageEntryPrice: number;   // weighted average
}
