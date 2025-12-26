import { Injectable, BadRequestException } from '@nestjs/common';
import { Trade, TradeSide } from './entities/trade.entity';
import { Position } from './entities/position.entity';
import { CreateTradeDto } from './dto/create-trade.dto';
import { v4 as uuidv4 } from 'uuid';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';
import Decimal from 'decimal.js';
import { toDecimal } from '../common/utils/decimal.util';

// Trade recording and FIFO matching with Decimal.js precision.
// All financial calculations use exact decimal arithmetic.
@Injectable()
export class PortfolioService {
  constructor(
    private readonly storage: PortfolioStorageService,
    private readonly marketPriceService: MarketPriceService,
  ) {}

  /**
   * Records trade and updates position state.
   * Idempotent - duplicate tradeId returns existing record.
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
      price: toDecimal(createTradeDto.price),
      quantity: toDecimal(createTradeDto.quantity),
      executionTimestamp: new Date(createTradeDto.executionTimestamp),
      createdAt: new Date(),
    };

    this.storage.saveTrade(trade);
    this.updatePosition(trade);

    return trade;
  }

  // Updates position state after trade execution.
  // Buy: adds to FIFO queue, recalcs avg entry.
  // Sell: consumes lots via FIFO, records realized P&L.
  private updatePosition(trade: Trade): void {
    const { symbol, side } = trade;

    let position = this.storage.getPosition(symbol);
    if (!position) {
      position = {
        symbol,
        fifoQueue: [],
        totalQuantity: new Decimal(0),
        averageEntryPrice: new Decimal(0),
      };
    }

    if (side === TradeSide.BUY) {
      this.handleBuy(position, trade);
    } else {
      this.handleSell(position, trade);
    }

    this.storage.savePosition(position);
  }

  // Adds buy to FIFO queue and recalculates average entry price.
  private handleBuy(position: Position, trade: Trade): void {
    position.fifoQueue.push({
      quantity: trade.quantity,
      price: trade.price,
      tradeId: trade.id,
    });

    position.totalQuantity = position.totalQuantity.plus(trade.quantity);
    const totalCost = position.fifoQueue.reduce(
      (sum, lot) => sum.plus(lot.quantity.times(lot.price)),
      new Decimal(0)
    );
    position.averageEntryPrice = totalCost.dividedBy(position.totalQuantity);
  }

  // Consumes lots via FIFO, records realized P&L per lot.
  // Supports partial lot consumption.
  private handleSell(position: Position, trade: Trade): void {
    let remainingQuantity = trade.quantity;

    if (position.totalQuantity.lessThan(remainingQuantity)) {
      throw new BadRequestException(
        `Insufficient quantity for ${trade.symbol}. Available: ${position.totalQuantity.toString()}, Requested: ${remainingQuantity.toString()}`,
      );
    }
    
    while (remainingQuantity.greaterThan(0) && position.fifoQueue.length > 0) {
      const oldestLot = position.fifoQueue[0];

      if (oldestLot.quantity.lessThanOrEqualTo(remainingQuantity)) {
        // full lot consumption
        const pnl = trade.price.minus(oldestLot.price).times(oldestLot.quantity);

        this.storage.savePnlRecord({
          symbol: trade.symbol,
          quantity: oldestLot.quantity,
          buyPrice: oldestLot.price,
          sellPrice: trade.price,
          pnl,
          timestamp: trade.executionTimestamp,
        });

        remainingQuantity = remainingQuantity.minus(oldestLot.quantity);
        position.fifoQueue.shift();
      } else {
        // partial lot
        const soldQuantity = remainingQuantity;
        const pnl = trade.price.minus(oldestLot.price).times(soldQuantity);

        this.storage.savePnlRecord({
          symbol: trade.symbol,
          quantity: soldQuantity,
          buyPrice: oldestLot.price,
          sellPrice: trade.price,
          pnl,
          timestamp: trade.executionTimestamp,
        });

        oldestLot.quantity = oldestLot.quantity.minus(soldQuantity);
        remainingQuantity = new Decimal(0);
      }
    }

    position.totalQuantity = position.totalQuantity.minus(trade.quantity);

    // recalc avg price for remaining lots
    if (position.totalQuantity.greaterThan(0)) {
      const totalCost = position.fifoQueue.reduce(
        (sum, lot) => sum.plus(lot.quantity.times(lot.price)),
        new Decimal(0)
      );
      position.averageEntryPrice = totalCost.dividedBy(position.totalQuantity);
    } else {
      position.averageEntryPrice = new Decimal(0);
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
