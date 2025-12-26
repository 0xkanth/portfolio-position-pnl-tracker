import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';
import { TradeSide } from './entities/trade.entity';
import { BadRequestException } from '@nestjs/common';
import { CreateTradeDto } from './dto/create-trade.dto';
import Decimal from 'decimal.js';

describe('PortfolioService - Mutations', () => {
  let service: PortfolioService;
  let storage: PortfolioStorageService;
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
      providers: [PortfolioStorageService, MarketPriceService, PortfolioService],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
    storage = module.get<PortfolioStorageService>(PortfolioStorageService);
    marketPriceService = module.get<MarketPriceService>(MarketPriceService);
    tradeIdCounter = 1;
    orderIdCounter = 1;
    
    // Market prices are automatically initialized by MarketPriceService
  });

  afterEach(() => {
    storage.clearAllData();
    marketPriceService.clearAllPrices();
  });

  describe('addTrade', () => {
    it('should add a buy trade successfully', () => {
      const trade = service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      expect(trade).toBeDefined();
      expect(trade.id).toBeDefined();
      expect(trade.tradeId).toBeDefined();
      expect(trade.orderId).toBeDefined();
      expect(trade.symbol).toBe('BTC');
      expect(trade.side).toBe(TradeSide.BUY);
      expect(trade.executionTimestamp).toBeInstanceOf(Date);
      expect(trade.createdAt).toBeInstanceOf(Date);
    });

    it('should add a sell trade successfully when sufficient balance exists', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 2,
      }));

      const sellTrade = service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 45000,
        quantity: 1,
      }));

      expect(sellTrade).toBeDefined();
      expect(sellTrade.side).toBe(TradeSide.SELL);
    });

    it('should throw error when selling without sufficient quantity', () => {
      expect(() => {
        service.addTrade(createTestTradeDto({
          symbol: 'BTC',
          side: TradeSide.SELL,
          price: 45000,
          quantity: 1,
        }));
      }).toThrow(BadRequestException);
    });

    it('should handle FIFO matching correctly during sell', () => {
      // Buy at different prices
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 42000,
        quantity: 1,
      }));

      // Sell 1 BTC - should match against first lot (FIFO)
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 43000,
        quantity: 1,
      }));

      // Verify position was updated correctly (oldest lot removed)
      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(1);
      expect(position!.averageEntryPrice.toNumber()).toBe(42000); // Only second lot remains
    });

    it('should handle partial lot consumption', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 2,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 42000,
        quantity: 2,
      }));

      // Sell 3 BTC - consumes all of first lot and half of second
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 45000,
        quantity: 3,
      }));

      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(1);
      expect(position!.averageEntryPrice.toNumber()).toBe(42000);
    });

    it('should update position correctly after exact quantity sell', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 45000,
        quantity: 1,
      }));

      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(0); // Position closed
      expect(position!.fifoQueue).toHaveLength(0); // No lots remaining
    });
  });

  describe('Idempotency', () => {
    it('should return existing trade when duplicate tradeId submitted', () => {
      const dto = createTestTradeDto({
        tradeId: 'trade-unique-001',
        symbol: 'BTC',
        price: 40000,
        quantity: 1,
      });

      const firstSubmission = service.addTrade(dto);
      expect(firstSubmission.tradeId).toBe('trade-unique-001');

      const duplicateSubmission = service.addTrade(dto);
      expect(duplicateSubmission.id).toBe(firstSubmission.id);
      expect(duplicateSubmission.tradeId).toBe(firstSubmission.tradeId);

      // Verify no duplicate in storage
      const allTrades = storage.getAllTrades();
      const matchingTrades = allTrades.filter(t => t.tradeId === 'trade-unique-001');
      expect(matchingTrades).toHaveLength(1);
    });

    it('should not double-count position when duplicate trade submitted', () => {
      const dto = createTestTradeDto({
        tradeId: 'trade-unique-002',
        symbol: 'BTC',
        price: 40000,
        quantity: 1,
      });

      service.addTrade(dto);
      service.addTrade(dto); // Duplicate

      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(1); // Not 2!
    });
  });

  describe('Multi-symbol trades', () => {
    it('should handle trades across multiple symbols independently', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2000,
        quantity: 5,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 45000,
        quantity: 0.5,
      }));

      const btcPosition = storage.getPosition('BTC');
      const ethPosition = storage.getPosition('ETH');

      expect(btcPosition!.totalQuantity.toNumber()).toBe(0.5);
      expect(ethPosition!.totalQuantity.toNumber()).toBe(5);
    });
  });

  describe('FIFO PnL Record Creation', () => {
    it('should create PnL records for each FIFO lot consumed', () => {
      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.BUY, price: 100, quantity: 10 }));
      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.BUY, price: 110, quantity: 5 }));
      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.SELL, price: 120, quantity: 12 }));

      // Should have created 2 PnL records (consumed 2 lots)
      const records = storage.getPnlRecordsBySymbol('BTC');
      expect(records.length).toBeGreaterThanOrEqual(2);
    });

    it('should update aggregation cache on each sell', () => {
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.BUY, price: 2000, quantity: 5 }));
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.SELL, price: 2200, quantity: 3 }));

      const aggregates = storage.getRealizedPnlAggregates();
      const ethAggregate = aggregates.get('ETH');

      expect(ethAggregate).toBeDefined();
      expect(ethAggregate!.totalPnl.toNumber()).toBe(600); // (2200-2000)*3
      expect(ethAggregate!.totalQuantity.toNumber()).toBe(3);
    });

    it('should accumulate PnL across multiple sells', () => {
      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.BUY, price: 40000, quantity: 1 }));
      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.SELL, price: 42000, quantity: 0.5 }));
      
      let aggregates = storage.getRealizedPnlAggregates();
      let btcAggregate = aggregates.get('BTC');
      expect(btcAggregate!.totalPnl.toNumber()).toBe(1000); // (42000-40000)*0.5

      service.addTrade(createTestTradeDto({ symbol: 'BTC', side: TradeSide.SELL, price: 43000, quantity: 0.5 }));
      
      aggregates = storage.getRealizedPnlAggregates();
      btcAggregate = aggregates.get('BTC');
      expect(btcAggregate!.totalPnl.toNumber()).toBe(2500); // 1000 + (43000-40000)*0.5
    });
  });

  describe('Decimal precision tests', () => {
    it('should handle clean decimal quantities', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 0.5,
      }));

      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(0.5);
    });

    it('should handle high-precision decimal prices', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 43234.567891234,
        quantity: 0.00123456,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 45678.912345678,
        quantity: 0.00123456,
      }));

      const aggregates = storage.getRealizedPnlAggregates();
      const btcAggregate = aggregates.get('BTC');
      // (45678.912345678 - 43234.567891234) × 0.00123456 = 3.01768988...
      expect(btcAggregate!.totalPnl.toNumber()).toBeCloseTo(3.01768989, 8);
    });

    it('should handle mixed clean and messy decimals', () => {
      // Clean whole number price, messy decimal quantity
      service.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 3000,
        quantity: 1.23456789,
      }));

      // Messy price, clean quantity
      service.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2987.654321,
        quantity: 2.5,
      }));

      const position = storage.getPosition('ETH');
      expect(position!.totalQuantity.toNumber()).toBeCloseTo(3.73456789, 8);
      // avg = (3000×1.23456789 + 2987.654321×2.5) / 3.73456789 = 2991.735537...
      expect(position!.averageEntryPrice.toNumber()).toBeCloseTo(2991.74, 2);
    });

    it('should handle micro-amounts with large prices', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 87250.123456,
        quantity: 0.00000001,
      }));

      const position = storage.getPosition('BTC');
      expect(position!.totalQuantity.toNumber()).toBe(0.00000001);
      expect(position!.averageEntryPrice.toNumber()).toBeCloseTo(87250.123456, 6);
    });

    it('should accumulate P&L across mixed decimal trades', () => {
      // Trade 1: Clean values
      service.addTrade(createTestTradeDto({ symbol: 'SOL', side: TradeSide.BUY, price: 100, quantity: 10 }));
      service.addTrade(createTestTradeDto({ symbol: 'SOL', side: TradeSide.SELL, price: 110, quantity: 5 }));
      
      // Trade 2: Messy decimals
      service.addTrade(createTestTradeDto({ symbol: 'SOL', side: TradeSide.SELL, price: 115.678912, quantity: 2.5 }));
      
      const aggregates = storage.getRealizedPnlAggregates();
      const solAggregate = aggregates.get('SOL');
      // PnL1: (110-100)×5 = 50
      // PnL2: (115.678912-100)×2.5 = 39.19728
      expect(solAggregate!.totalPnl.toNumber()).toBeCloseTo(89.19728, 5);
      expect(solAggregate!.totalQuantity.toNumber()).toBe(7.5);
    });

    it('should handle negative PnL with mixed decimals', () => {
      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 45123.456789,
        quantity: 0.123,
      }));

      service.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 40000.123456,
        quantity: 0.123,
      }));

      const aggregates = storage.getRealizedPnlAggregates();
      const btcAggregate = aggregates.get('BTC');
      // (40000.123456 - 45123.456789) × 0.123 = -630.169999959
      expect(btcAggregate!.totalPnl.toNumber()).toBeCloseTo(-630.17, 2);
    });

    it('should maintain precision across multiple FIFO lot matches', () => {
      // 3 buys with different precisions
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.BUY, price: 2500, quantity: 1 }));
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.BUY, price: 2750.5, quantity: 1.5 }));
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.BUY, price: 2999.999999, quantity: 0.75 }));

      // Sell spanning all 3 lots
      service.addTrade(createTestTradeDto({ symbol: 'ETH', side: TradeSide.SELL, price: 3100.123456, quantity: 3.25 }));

      const aggregates = storage.getRealizedPnlAggregates();
      const ethAggregate = aggregates.get('ETH');
      // Lot1: (3100.123456-2500)×1 = 600.123456
      // Lot2: (3100.123456-2750.5)×1.5 = 524.435184
      // Lot3: (3100.123456-2999.999999)×0.75 = 75.092593...
      expect(ethAggregate!.totalPnl.toNumber()).toBeCloseTo(1199.65, 2);
    });
  });
});

