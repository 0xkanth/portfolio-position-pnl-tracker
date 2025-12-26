import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PortfolioQueryService } from './portfolio-query.service';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceService } from '../market-price/market-price.service';
import { TradeSide } from './entities/trade.entity';
import { CreateTradeDto } from './dto/create-trade.dto';

describe('PortfolioController', () => {
  let controller: PortfolioController;
  let service: PortfolioService;
  let tradeIdCounter = 1;

  const createTestTradeDto = (overrides: Partial<CreateTradeDto>): CreateTradeDto => {
    return {
      tradeId: `trade-${tradeIdCounter++}`,
      orderId: `order-1`,
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
      controllers: [PortfolioController],
      providers: [PortfolioStorageService, MarketPriceService, PortfolioService, PortfolioQueryService],
    }).compile();

    controller = module.get<PortfolioController>(PortfolioController);
    service = module.get<PortfolioService>(PortfolioService);
    tradeIdCounter = 1;
  });

  afterEach(() => {
    service.clearAll();
  });

  describe('addTrade', () => {
    it('should create a trade and return proper response', () => {
      const createTradeDto = createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      });

      const result = controller.addTrade(createTradeDto);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.tradeId).toBeDefined();
      expect(result.orderId).toBeDefined();
      expect(result.symbol).toBe('BTC');
      expect(result.side).toBe(TradeSide.BUY);
      expect(result.price).toBe(40000);
      expect(result.quantity).toBe(1);
      expect(result.executionTimestamp).toBeDefined();
      expect(result.duplicate).toBe(false);
      expect(result.message).toBe('Trade recorded successfully');
    });

    it('should return existing trade for duplicate tradeId', () => {
      const dto = createTestTradeDto({
        tradeId: 'fixed-trade-id',
        symbol: 'BTC',
        price: 40000,
        quantity: 1,
      });

      const first = controller.addTrade(dto);
      const second = controller.addTrade(dto);

      expect(second.id).toBe(first.id);
      expect(second.duplicate).toBe(true);
      expect(second.message).toBe('Trade already recorded (idempotent)');
    });
  });

  describe('getPortfolio', () => {
    it('should return portfolio with positions', () => {
      controller.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      const portfolio = controller.getPortfolio();

      expect(portfolio).toBeDefined();
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.positions[0].symbol).toBe('BTC');
      expect(portfolio.totalValue).toBeGreaterThan(0);
    });
  });

  describe('getPnl', () => {
    it('should return PnL information', () => {
      controller.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 2,
      }));

      controller.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.SELL,
        price: 43000,
        quantity: 1,
      }));

      const pnl = controller.getPnl();

      expect(pnl).toBeDefined();
      expect(pnl.realizedPnl).toBeDefined();
      expect(pnl.unrealizedPnl).toBeDefined();
      expect(pnl.totalRealizedPnl).toBeDefined();
      expect(pnl.totalUnrealizedPnl).toBeDefined();
      expect(pnl.netPnl).toBeDefined();
    });
  });

  describe('getAllTrades', () => {
    it('should return all trades', () => {
      controller.addTrade(createTestTradeDto({
        symbol: 'BTC',
        side: TradeSide.BUY,
        price: 40000,
        quantity: 1,
      }));

      controller.addTrade(createTestTradeDto({
        symbol: 'ETH',
        side: TradeSide.BUY,
        price: 2000,
        quantity: 5,
      }));

      const trades = controller.getAllTrades();

      expect(trades).toHaveLength(2);
    });
  });
});
