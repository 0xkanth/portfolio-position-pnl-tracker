import { Injectable } from '@nestjs/common';
import { Trade } from './entities/trade.entity';
import { Position, FifoLot } from './entities/position.entity';
import { RealizedPnlRecord, RealizedPnlAggregate } from './entities/realized-pnl-record.entity';
import Decimal from 'decimal.js';

// In-memory storage with O(1) lookups and exact Decimal arithmetic.
// Trade deduplication via tradeId index.
// Realized P&L cached in aggregates for fast reads.
@Injectable()
export class PortfolioStorageService {
  private trades: Trade[] = [];
  private tradeIdIndex: Map<string, Trade> = new Map();

  private positions: Map<string, Position> = new Map();

  private pnlRecords: Map<string, RealizedPnlRecord[]> = new Map();
  private realizedPnlAggregates: Map<string, RealizedPnlAggregate> = new Map();

  /** Persists trade and indexes by tradeId for idempotency */
  saveTrade(trade: Trade): Trade {
    this.trades.push(trade);
    this.tradeIdIndex.set(trade.tradeId, trade);
    return trade;
  }

  /** O(1) lookup by external tradeId */
  findTradeByTradeId(tradeId: string): Trade | undefined {
    return this.tradeIdIndex.get(tradeId);
  }

  /** Returns defensive copy to prevent external mutation */
  getAllTrades(): Trade[] {
    return [...this.trades];
  }

  /** Total trades recorded - useful for testing/metrics */
  getTradeCount(): number {
    return this.trades.length;
  }

  /** Fetches position state with FIFO queue */
  getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol);
  }

  /** Persists updated position after trade matching */
  savePosition(position: Position): void {
    this.positions.set(position.symbol, position);
  }

  getAllPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  deletePosition(symbol: string): void {
    this.positions.delete(symbol);
  }

  // Stores P&L record and updates aggregate cache for O(1) reads.
  savePnlRecord(record: RealizedPnlRecord): void {
    if (!this.pnlRecords.has(record.symbol)) {
      this.pnlRecords.set(record.symbol, []);
    }
    this.pnlRecords.get(record.symbol)!.push(record);
    
    if (!this.realizedPnlAggregates.has(record.symbol)) {
      this.realizedPnlAggregates.set(record.symbol, { 
        totalPnl: new Decimal(0), 
        totalQuantity: new Decimal(0) 
      });
    }
    const aggregate = this.realizedPnlAggregates.get(record.symbol)!;
    aggregate.totalPnl = aggregate.totalPnl.plus(record.pnl);
    aggregate.totalQuantity = aggregate.totalQuantity.plus(record.quantity);
  }

  /** Flattens all P&L records across symbols */
  getAllPnlRecords(): RealizedPnlRecord[] {
    return Array.from(this.pnlRecords.values()).flat();
  }

  /** Returns cached aggregates - O(1) for P&L queries */
  getRealizedPnlAggregates(): Map<string, RealizedPnlAggregate> {
    return this.realizedPnlAggregates;
  }

  /** History of closed trades for specific symbol */
  getPnlRecordsBySymbol(symbol: string): RealizedPnlRecord[] {
    return this.pnlRecords.get(symbol) || [];
  }

  /** Nukes all storage - test harness only */
  clearAllData(): void {
    this.trades = [];
    this.tradeIdIndex.clear();
    this.positions.clear();
    this.pnlRecords.clear();
    this.realizedPnlAggregates.clear();
  }
}
