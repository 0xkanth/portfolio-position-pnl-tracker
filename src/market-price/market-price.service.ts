import { Injectable } from '@nestjs/common';

/**
 * Market price provider for unrealized P&L calculations.
 * Manual updates via REST API - no live feeds.
 * Production would use WebSocket subscriptions or market data vendor.
 */
@Injectable()
export class MarketPriceService {
  private latestPrices: Map<string, number> = new Map();
  private lastPriceUpdate: Date = new Date();

  constructor() {
    this.initializeDefaultPrices();
  }

  /** Seeds common symbols for testing */
  private initializeDefaultPrices(): void {
    this.latestPrices.set('BTC', 44000);
    this.latestPrices.set('ETH', 2500);
    this.latestPrices.set('SOL', 100);
    this.latestPrices.set('LINK', 14);
    this.latestPrices.set('UNI', 5);
  }

  /** O(1) lookup - returns undefined if symbol not tracked */
  getPrice(symbol: string): number | undefined {
    return this.latestPrices.get(symbol);
  }

  /** Returns snapshot of all tracked prices */
  getAllPrices(): Record<string, number> {
    const prices: Record<string, number> = {};
    this.latestPrices.forEach((price, symbol) => {
      prices[symbol] = price;
    });
    return prices;
  }

  /** Batch fetch for specific symbols - omits missing */
  getPrices(symbols: string[]): Record<string, number> {
    const prices: Record<string, number> = {};
    symbols.forEach(symbol => {
      const price = this.latestPrices.get(symbol);
      if (price !== undefined) {
        prices[symbol] = price;
      }
    });
    return prices;
  }

  /**
   * Updates single symbol price.
   * @throws Error if price <= 0
   */
  updatePrice(symbol: string, price: number): void {
    if (price <= 0) {
      throw new Error(`Price must be positive, got ${price} for ${symbol}`);
    }
    this.latestPrices.set(symbol, price);
    this.lastPriceUpdate = new Date();
  }

  /**
   * Batch price updates - validates all before applying.
   * @throws Error on first invalid price
   */
  updatePrices(prices: Record<string, number>): void {
    Object.entries(prices).forEach(([symbol, price]) => {
      if (price <= 0) {
        throw new Error(`Price must be positive, got ${price} for ${symbol}`);
      }
      this.latestPrices.set(symbol, price);
    });
    this.lastPriceUpdate = new Date();
  }

  /** Timestamp of most recent price update */
  getLastUpdateTime(): Date {
    return this.lastPriceUpdate;
  }

  /** Checks if symbol has tracked price */
  hasPrice(symbol: string): boolean {
    return this.latestPrices.has(symbol);
  }

  /** Returns all symbols with known prices */
  getAvailableSymbols(): string[] {
    return Array.from(this.latestPrices.keys());
  }

  /** Resets to defaults - test harness only */
  clearAllPrices(): void {
    this.latestPrices.clear();
    this.initializeDefaultPrices();
    this.lastPriceUpdate = new Date();
  }
}
