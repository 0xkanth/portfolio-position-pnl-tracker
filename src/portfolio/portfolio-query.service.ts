import { Injectable } from '@nestjs/common';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';
import { PnlResponseDto } from './dto/pnl-response.dto';
import { PortfolioResponseDto } from './dto/portfolio-response.dto';

// Read-only operations for portfolio data.
// CQRS pattern - queries separated from mutations.
@Injectable()
export class PortfolioQueryService {
  constructor(
    private readonly storage: PortfolioStorageService,
    private readonly marketPriceService: MarketPriceService,
  ) {}

  /**
   * Returns current holdings with unrealized P&L.
   * Excludes closed positions (totalQuantity = 0).
   * Uses latest market price or entry price as fallback.
   * 
   * @param symbols - Optional filter for specific symbols
   */
  getPortfolio(symbols?: string[]): PortfolioResponseDto {
    let positions = this.storage.getAllPositions();
    
    if (symbols && symbols.length > 0) {
      const symbolSet = new Set(symbols);
      positions = positions.filter((pos) => symbolSet.has(pos.symbol));
    }
    const positionsWithPnl = positions
      .filter((pos) => pos.totalQuantity > 0)
      .map((pos) => {
        const currentPrice = this.marketPriceService.getPrice(pos.symbol) || pos.averageEntryPrice;
        const currentValue = currentPrice * pos.totalQuantity;
        const unrealizedPnl = (currentPrice - pos.averageEntryPrice) * pos.totalQuantity;

        return {
          symbol: pos.symbol,
          totalQuantity: pos.totalQuantity,
          averageEntryPrice: Number(pos.averageEntryPrice.toFixed(2)),
          currentPrice,
          currentValue: Number(currentValue.toFixed(2)),
          unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
        };
      });

    const totalValue = positionsWithPnl.reduce((sum, pos) => sum + pos.currentValue, 0);
    const totalUnrealizedPnl = positionsWithPnl.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);

    return {
      positions: positionsWithPnl,
      totalValue: Number(totalValue.toFixed(2)),
      totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
    };
  }

  /**
   * Calculates realized + unrealized P&L across portfolio.
   * Realized: cached aggregates from closed trades (O(1) lookup)
   * Unrealized: current positions vs market price
   * 
   * @param symbols - Optional filter for specific symbols
   */
  getPnl(symbols?: string[]): PnlResponseDto {
    const realizedBySymbol = this.storage.getRealizedPnlAggregates();
    let realizedPnl = Array.from(realizedBySymbol.entries()).map(([symbol, data]) => ({
      symbol,
      realizedPnl: Number(data.totalPnl.toFixed(2)),
      closedQuantity: data.totalQuantity,
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
      .filter((pos) => pos.totalQuantity > 0)
      .map((pos) => {
        const currentPrice = this.marketPriceService.getPrice(pos.symbol) || pos.averageEntryPrice;
        const unrealizedPnl = (currentPrice - pos.averageEntryPrice) * pos.totalQuantity;

        return {
          symbol: pos.symbol,
          unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
          currentQuantity: pos.totalQuantity,
          averageEntryPrice: Number(pos.averageEntryPrice.toFixed(2)),
          currentPrice,
        };
      });

    const totalRealizedPnl = realizedPnl.reduce((sum, item) => sum + item.realizedPnl, 0);
    const totalUnrealizedPnl = unrealizedPnl.reduce((sum, item) => sum + item.unrealizedPnl, 0);

    return {
      realizedPnl,
      unrealizedPnl,
      totalRealizedPnl: Number(totalRealizedPnl.toFixed(2)),
      totalUnrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
      netPnl: Number((totalRealizedPnl + totalUnrealizedPnl).toFixed(2)),
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
