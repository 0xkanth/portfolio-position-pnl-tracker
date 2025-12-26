import { Injectable, BadRequestException } from '@nestjs/common';
import { Trade, TradeSide } from './entities/trade.entity';
import { Position } from './entities/position.entity';
import { CreateTradeDto } from './dto/create-trade.dto';
import { v4 as uuidv4 } from 'uuid';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';

// Handles trade recording and FIFO matching logic.
// Storage and pricing delegated to separate services.
@Injectable()
export class PortfolioService {
  constructor(
    private readonly storage: PortfolioStorageService,
    private readonly marketPriceService: MarketPriceService,
  ) {}

  /**
   * Records a new trade and updates position state.
   * Idempotent - duplicate tradeId returns existing record.
   * 
   * @param createTradeDto - Trade details from external order execution
   * @returns Persisted trade entity
   * @throws BadRequestException if sell quantity exceeds position
   */
  addTrade(createTradeDto: CreateTradeDto): Trade {
    const existingTrade = this.storage.findTradeByTradeId(createTradeDto.tradeId);
    if (existingTrade) {
      return existingTrade;
    }

    const trade: Trade = {
      id: uuidv4(),
      tradeId: createTradeDto.tradeId,
      orderId: createTradeDto.orderId,
      symbol: createTradeDto.symbol,
      side: createTradeDto.side,
      price: createTradeDto.price,
      quantity: createTradeDto.quantity,
      executionTimestamp: new Date(createTradeDto.executionTimestamp),
      createdAt: new Date(),
    };

    this.storage.saveTrade(trade);
    this.updatePosition(trade);

    return trade;
  }

  /**
   * Updates position state after trade execution.
   * Buy: adds to FIFO queue, recalcs avg entry price
   * Sell: consumes lots via FIFO matching, records realized P&L
   */
  private updatePosition(trade: Trade): void {
    const { symbol, side } = trade;

    let position = this.storage.getPosition(symbol);
    if (!position) {
      position = {
        symbol,
        fifoQueue: [],
        totalQuantity: 0,
        averageEntryPrice: 0,
      };
    }

    if (side === TradeSide.BUY) {
      this.handleBuy(position, trade);
    } else {
      this.handleSell(position, trade);
    }

    this.storage.savePosition(position);
  }

  /**
   * Adds buy trade to position's FIFO queue.
   * Recalculates average entry price across all lots.
   */
  private handleBuy(position: Position, trade: Trade): void {
    position.fifoQueue.push({
      quantity: trade.quantity,
      price: trade.price,
      tradeId: trade.id,
    });

    position.totalQuantity += trade.quantity;
    const totalCost = position.fifoQueue.reduce((sum, lot) => sum + lot.quantity * lot.price, 0);
    position.averageEntryPrice = totalCost / position.totalQuantity;
  }

  /**
   * Consumes position lots via FIFO matching.
   * Records realized P&L for each matched lot.
   * Supports partial lot consumption.
   * 
   * @throws BadRequestException if position quantity insufficient
   */
  private handleSell(position: Position, trade: Trade): void {
    let remainingQuantity = trade.quantity;

    if (position.totalQuantity < remainingQuantity) {
      throw new BadRequestException(
        `Insufficient quantity for ${trade.symbol}. Available: ${position.totalQuantity}, Requested: ${remainingQuantity}`,
      );
    }
    while (remainingQuantity > 0 && position.fifoQueue.length > 0) {
      const oldestLot = position.fifoQueue[0];

      if (oldestLot.quantity <= remainingQuantity) {
        // full lot consumption
        const pnl = (trade.price - oldestLot.price) * oldestLot.quantity;

        this.storage.savePnlRecord({
          symbol: trade.symbol,
          quantity: oldestLot.quantity,
          buyPrice: oldestLot.price,
          sellPrice: trade.price,
          pnl,
          timestamp: trade.executionTimestamp,
        });

        remainingQuantity -= oldestLot.quantity;
        position.fifoQueue.shift();
      } else {
        // partial lot
        const soldQuantity = remainingQuantity;
        const pnl = (trade.price - oldestLot.price) * soldQuantity;

        this.storage.savePnlRecord({
          symbol: trade.symbol,
          quantity: soldQuantity,
          buyPrice: oldestLot.price,
          sellPrice: trade.price,
          pnl,
          timestamp: trade.executionTimestamp,
        });

        oldestLot.quantity -= soldQuantity;
        remainingQuantity = 0;
      }
    }

    position.totalQuantity -= trade.quantity;

    // recalc avg price for remaining lots
    if (position.totalQuantity > 0) {
      const totalCost = position.fifoQueue.reduce((sum, lot) => sum + lot.quantity * lot.price, 0);
      position.averageEntryPrice = totalCost / position.totalQuantity;
    } else {
      position.averageEntryPrice = 0;
    }
  }

  /** Updates single symbol's market price for unrealized P&L calc */
  updatePrice(symbol: string, price: number): void {
    this.marketPriceService.updatePrice(symbol, price);
  }

  /** Batch updates market prices across multiple symbols */
  updatePrices(prices: Record<string, number>): void {
    this.marketPriceService.updatePrices(prices);
  }

  /** Clears all state - test harness only */
  clearAll(): void {
    this.storage.clearAllData();
    this.marketPriceService.clearAllPrices();
  }
}
