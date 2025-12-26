import { Injectable } from '@nestjs/common';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';
import { PnlResponseDto } from './dto/pnl-response.dto';
import { PortfolioResponseDto } from './dto/portfolio-response.dto';
import Decimal from 'decimal.js';
import { toDecimal, toNumber } from '../common/utils/decimal.util';

// Read-only queries with Decimal precision.
// CQRS pattern - queries separated from mutations.
@Injectable()
export class PortfolioQueryService {
  constructor(
    private readonly storage: PortfolioStorageService,
    private readonly marketPriceService: MarketPriceService,
  ) {}

  // Returns current holdings with unrealized P&L.
  // Excludes closed positions, uses market price or entry price fallback.
  getPortfolio(symbols?: string[]): PortfolioResponseDto {
    let positions = this.storage.getAllPositions();
    
    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      positions = positions.filter((pos) => symbolSet.has(pos.symbol));
    }
    const positionsWithPnl = positions
      .filter((pos) => pos.totalQuantity.greaterThan(0))
      .map((pos) => {
        const marketPrice = this.marketPriceService.getPrice(pos.symbol);
        const currentPrice = marketPrice ? toDecimal(marketPrice) : pos.averageEntryPrice;
        const currentValue = currentPrice.times(pos.totalQuantity);
        const unrealizedPnl = currentPrice.minus(pos.averageEntryPrice).times(pos.totalQuantity);

        return {
          symbol: pos.symbol,
          totalQuantity: toNumber(pos.totalQuantity),
          averageEntryPrice: toNumber(pos.averageEntryPrice),
          currentPrice: toNumber(currentPrice),
          currentValue: toNumber(currentValue),
          unrealizedPnl: toNumber(unrealizedPnl),
        };
      });

    const totalValue = positionsWithPnl.reduce((sum, pos) => sum + pos.currentValue, 0);
    const totalUnrealizedPnl = positionsWithPnl.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    return {
      positions: positionsWithPnl,
      totalValue: parseFloat(totalValue.toFixed(2)),
      totalUnrealizedPnl: parseFloat(totalUnrealizedPnl.toFixed(2)),
    };
  }

  // Calculates realized + unrealized P&L across portfolio.
  // Realized: O(1) cached aggregates. Unrealized: current positions vs market.
  getPnl(symbols?: string[]): PnlResponseDto {
    const realizedBySymbol = this.storage.getRealizedPnlAggregates();
    let realizedPnl = Array.from(realizedBySymbol.entries()).map(([symbol, data]) => ({
      symbol,
      realizedPnl: toNumber(data.totalPnl),
      closedQuantity: toNumber(data.totalQuantity),
    }));

    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      realizedPnl = realizedPnl.filter((item) => symbolSet.has(item.symbol));
    }

    // unrealized P&L for current positions
    let positions = this.storage.getAllPositions();
    
    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      positions = positions.filter((pos) => symbolSet.has(pos.symbol));
    }

    const unrealizedPnl = positions
      .filter((pos) => pos.totalQuantity.greaterThan(0))
      .map((pos) => {
        const marketPrice = this.marketPriceService.getPrice(pos.symbol);
        const currentPrice = marketPrice ? toDecimal(marketPrice) : pos.averageEntryPrice;
        const unrealizedPnl = currentPrice.minus(pos.averageEntryPrice).times(pos.totalQuantity);

        return {
          symbol: pos.symbol,
          unrealizedPnl: toNumber(unrealizedPnl),
          currentQuantity: toNumber(pos.totalQuantity),
          averageEntryPrice: toNumber(pos.averageEntryPrice),
          currentPrice: toNumber(currentPrice),
        };
      });

    const totalRealizedPnl = realizedPnl.reduce((sum, item) => sum + item.realizedPnl, 0);
    const totalUnrealizedPnl = unrealizedPnl.reduce((sum, item) => sum + item.unrealizedPnl, 0);

    return {
      realizedPnl,
      unrealizedPnl,
      totalRealizedPnl: parseFloat(totalRealizedPnl.toFixed(2)),
      totalUnrealizedPnl: parseFloat(totalUnrealizedPnl.toFixed(2)),
      netPnl: parseFloat((totalRealizedPnl + totalUnrealizedPnl).toFixed(2)),
    };
  }

  /** Returns all trades, optionally filtered by symbol */
  getAllTrades(symbol?: string) {
    const trades = this.storage.getAllTrades();
    
    if (symbol) {
      return trades.filter((trade) => trade.symbol === symbol);
    }
    
    return trades;
  }

  /** Finds trade by external tradeId - used for idempotency checks */
  getTradeByTradeId(tradeId: string) {
    return this.storage.findTradeByTradeId(tradeId);
  }

  /** Returns current market prices with last update timestamp */
  getMarketPrices(symbol?: string) {
    const lastUpdate = this.marketPriceService.getLastUpdateTime();

    if (symbol) {
      const price = this.marketPriceService.getPrice(symbol);
      return {
        prices: price !== undefined ? { [symbol]: price } : {},
        lastUpdate,
      };
    }

    return {
      prices: this.marketPriceService.getAllPrices(),
      lastUpdate,
    };
  }
}
