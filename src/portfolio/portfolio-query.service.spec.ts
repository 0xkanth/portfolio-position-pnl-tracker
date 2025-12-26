import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioQueryService } from './portfolio-query.service';
import { PortfolioStorageService } from './portfolio-storage.service';
import { PortfolioService } from './portfolio.service';
import { MarketPriceService } from '../market-price/market-price.service';
import { TradeSide } from './entities/trade.entity';
import { CreateTradeDto } from './dto/create-trade.dto';

describe('PortfolioQueryService', () => {
  let queryService: PortfolioQueryService;
  let portfolioService: PortfolioService;
  let storageService: PortfolioStorageService;
  let marketPriceService: MarketPriceService;
  let tradeIdCounter = 1;
  let orderIdCounter = 1;

  const createTestTradeDto = (overrides: Partial<CreateTradeDto>): CreateTradeDto => {
    return {
      tradeId: `trade-${tradeIdCounter++}`,
      orderId: `order-${orderIdCounter}`,
      symbol: 'BTC',
      side: TradeSide.BUY,
      price: 40000,
      quantity: 1,
      executionTimestamp: new Date().toISOString(),
      ...overrides,
    };
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PortfolioStorageService, MarketPriceService, PortfolioService, PortfolioQueryService],
    }).compile();

    queryService = module.get<PortfolioQueryService>(PortfolioQueryService);
    portfolioService = module.get<PortfolioService>(PortfolioService);
    storageService = module.get<PortfolioStorageService>(PortfolioStorageService);
    marketPriceService = module.get<MarketPriceService>(MarketPriceService);
    
    tradeIdCounter = 1;
    orderIdCounter = 1;
    
    // Market prices are automatically initialized by MarketPriceService
  });

  afterEach(() => {
    storageService.clearAllData();
    marketPriceService.clearAllPrices();
  });

  describe('getPortfolio', () => {
    it('should return empty portfolio initially', () => {
      const portfolio = queryService.getPortfolio();
      expect(portfolio.positions).toHaveLength(0);
      expect(portfolio.totalValue).toBe(0);
    });

    it('should return portfolio with all symbols', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2000,
        quantity: 5,
      }));

      const portfolio = queryService.getPortfolio();
      expect(portfolio.positions).toHaveLength(2);
      expect(portfolio.positions.find((p) => p.symbol === 'BTC')).toBeDefined();
      expect(portfolio.positions.find((p) => p.symbol === 'ETH')).toBeDefined();
    });

    it('should filter portfolio by symbol', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2000,
        quantity: 5,
      }));

      const portfolio = queryService.getPortfolio(['BTC']);
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.positions[0].symbol).toBe('BTC');
    });

    it('should return empty portfolio for non-existent symbol', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      const portfolio = queryService.getPortfolio(['ETH']);
      expect(portfolio.positions).toHaveLength(0);
      expect(portfolio.totalValue).toBe(0);
    });

    it('should calculate average entry price correctly for multiple buys', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 42000,
        quantity: 1,
      }));

      const portfolio = queryService.getPortfolio();
      const btcPosition = portfolio.positions.find((p) => p.symbol === 'BTC');

      expect(btcPosition).toBeDefined();
      expect(btcPosition!.totalQuantity).toBe(2);
      expect(btcPosition!.averageEntryPrice).toBe(41000);
    });

    it('should calculate unrealized PnL correctly', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      const portfolio = queryService.getPortfolio();
      const btcPosition = portfolio.positions.find((p) => p.symbol === 'BTC');

      // Latest price is 44000
      expect(btcPosition!.unrealizedPnl).toBe(4000);
    });
  });

  describe('getPnl', () => {
    it('should return empty PnL initially', () => {
      const pnl = queryService.getPnl();
      expect(pnl.realizedPnl).toHaveLength(0);
      expect(pnl.unrealizedPnl).toHaveLength(0);
      expect(pnl.totalRealizedPnl).toBe(0);
      expect(pnl.totalUnrealizedPnl).toBe(0);
      expect(pnl.netPnl).toBe(0);
    });

    it('should calculate realized PnL using FIFO', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 43000,
        quantity: 1,
      }));

      const pnl = queryService.getPnl();
      const btcRealizedPnl = pnl.realizedPnl.find((p) => p.symbol === 'BTC');

      expect(btcRealizedPnl).toBeDefined();
      expect(btcRealizedPnl!.realizedPnl).toBe(3000);
      expect(btcRealizedPnl!.closedQuantity).toBe(1);
    });

    it('should filter PnL by symbol', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 43000,
        quantity: 1,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2000,
        quantity: 5,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.SELL,
        price: 2500,
        quantity: 2,
      }));

      const pnl = queryService.getPnl(['BTC']);
      expect(pnl.realizedPnl).toHaveLength(1);
      expect(pnl.realizedPnl[0].symbol).toBe('BTC');
      expect(pnl.unrealizedPnl).toHaveLength(0);
    });

    it('should calculate unrealized PnL for remaining positions', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 41000,
        quantity: 1,
      }));

      const pnl = queryService.getPnl();
      const btcUnrealizedPnl = pnl.unrealizedPnl.find((p) => p.symbol === 'BTC');

      expect(btcUnrealizedPnl).toBeDefined();
      expect(btcUnrealizedPnl!.currentQuantity).toBe(1);
      expect(btcUnrealizedPnl!.averageEntryPrice).toBe(41000);
      expect(btcUnrealizedPnl!.currentPrice).toBe(44000);
      expect(btcUnrealizedPnl!.unrealizedPnl).toBe(3000);
    });

    it('should calculate total PnL correctly', () => {
      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 2,
      }));

      portfolioService.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 43000,
        quantity: 1,
      }));

      const pnl = queryService.getPnl();

      // Realized: (43000 - 40000) * 1 = 3000
      expect(pnl.totalRealizedPnl).toBe(3000);

      // Unrealized: (44000 - 40000) * 1 = 4000
      expect(pnl.totalUnrealizedPnl).toBe(4000);

      // Net PnL: 3000 + 4000 = 7000
      expect(pnl.netPnl).toBe(7000);
    });

    it('should handle multiple symbols independently', () => {
      // BTC trades
      portfolioService.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.BUY, price: 40000, quantity: 1 }));
      portfolioService.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.SELL, price: 42000, quantity: 1 }));

      // ETH trades
      portfolioService.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.BUY, price: 2000, quantity: 2 }));
      portfolioService.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.SELL, price: 2500, quantity: 2 }));

      const pnl = queryService.getPnl();

      const btcPnl = pnl.realizedPnl.find(p => p.symbol === 'BTC');
      const ethPnl = pnl.realizedPnl.find(p => p.symbol === 'ETH');

      expect(btcPnl!.realizedPnl).toBe(2000);
      expect(ethPnl!.realizedPnl).toBe(1000);
    });

    it('should use aggregation cache for O(1) performance', () => {
      // Generate many trades
      portfolioService.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.BUY, price: 40000, quantity: 100 }));
      
      for (let i = 0; i < 50; i++) {
        portfolioService.addTrade(createTestTradeDto({ 
          symbol: 'BTC', 
          side: TradeSide.SELL, 
          price: 40000 + (i * 100), 
          quantity: 1 
        }));
      }

      const startTime = process.hrtime.bigint();
      const pnl = queryService.getPnl();
      const endTime = process.hrtime.bigint();
      const latencyMs = Number(endTime - startTime) / 1_000_000;

      expect(pnl.realizedPnl.length).toBeGreaterThan(0);
      expect(latencyMs).toBeLessThan(5); // Should be fast due to caching
    });
  });

  describe('getAllTrades', () => {
    it('should return empty array initially', () => {
      const trades = queryService.getAllTrades();
      expect(trades).toHaveLength(0);
    });

    it('should return all trades', () => {
      portfolioService.addTrade(createTestTradeDto({ symbol: 'BTC', price: 40000 }));
      portfolioService.addTrade(createTestTradeDto({ symbol: 'ETH', price: 2000 }));

      const trades = queryService.getAllTrades();
      expect(trades).toHaveLength(2);
    });
  });

  describe('getTradeByTradeId', () => {
    it('should return trade by tradeId', () => {
      const dto = createTestTradeDto({ tradeId: 'test-123', symbol: 'BTC' });
      portfolioService.addTrade(dto);

      const trade = queryService.getTradeByTradeId('test-123');
      expect(trade).toBeDefined();
      expect(trade!.symbol).toBe('BTC');
    });

    it('should return undefined for non-existent tradeId', () => {
      const trade = queryService.getTradeByTradeId('non-existent');
      expect(trade).toBeUndefined();
    });
  });
});
