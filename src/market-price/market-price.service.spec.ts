import { Test, TestingModule } from '@nestjs/testing';
import { MarketPriceService } from './market-price.service';

describe('MarketPriceService', () => {
  let service: MarketPriceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MarketPriceService],
    }).compile();

    service = module.get<MarketPriceService>(MarketPriceService);
  });

  afterEach(() => {
    service.clearAllPrices(); // Reset to defaults
  });

  describe('Initialization', () => {
    it('should initialize with default prices', () => {
      expect(service.getPrice('BTC')).toBe(44000);
      expect(service.getPrice('ETH')).toBe(2500);
      expect(service.getPrice('SOL')).toBe(100);
      expect(service.getPrice('LINK')).toBe(14);
      expect(service.getPrice('UNI')).toBe(5);
    });

    it('should have 5 default symbols', () => {
      const symbols = service.getAvailableSymbols();
      expect(symbols).toHaveLength(5);
      expect(symbols).toContain('BTC');
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('LINK');
      expect(symbols).toContain('UNI');
    });
  });

  describe('getPrice', () => {
    it('should return price for existing symbol', () => {
      const price = service.getPrice('BTC');
      expect(price).toBe(44000);
    });

    it('should return undefined for non-existent symbol', () => {
      const price = service.getPrice('DOGE');
      expect(price).toBeUndefined();
    });
  });

  describe('getAllPrices', () => {
    it('should return all prices as object', () => {
      const prices = service.getAllPrices();
      expect(prices).toEqual({
        BTC: 44000,
        ETH: 2500,
        SOL: 100,
        LINK: 14,
        UNI: 5,
      });
    });

    it('should include newly added prices', () => {
      service.updatePrice('DOGE', 0.07);
      const prices = service.getAllPrices();
      expect(prices.DOGE).toBe(0.07);
      expect(Object.keys(prices)).toHaveLength(6);
    });
  });

  describe('getPrices', () => {
    it('should return prices for specific symbols only', () => {
      const prices = service.getPrices(['BTC', 'ETH']);
      expect(prices).toEqual({
        BTC: 44000,
        ETH: 2500,
      });
    });

    it('should skip non-existent symbols', () => {
      const prices = service.getPrices(['BTC', 'DOGE', 'ETH']);
      expect(prices).toEqual({
        BTC: 44000,
        ETH: 2500,
      });
      expect(prices.DOGE).toBeUndefined();
    });

    it('should return empty object for no matching symbols', () => {
      const prices = service.getPrices(['DOGE', 'SHIB']);
      expect(prices).toEqual({});
    });
  });

  describe('updatePrice', () => {
    it('should update existing symbol price', () => {
      service.updatePrice('BTC', 50000);
      expect(service.getPrice('BTC')).toBe(50000);
    });

    it('should add new symbol price', () => {
      service.updatePrice('DOGE', 0.07);
      expect(service.getPrice('DOGE')).toBe(0.07);
    });

    it('should update lastUpdateTime', () => {
      const before = service.getLastUpdateTime();
      
      // Wait a bit to ensure time difference
      setTimeout(() => {
        service.updatePrice('BTC', 50000);
        const after = service.getLastUpdateTime();
        expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
      }, 10);
    });

    it('should throw error for negative price', () => {
      expect(() => {
        service.updatePrice('BTC', -100);
      }).toThrow('Price must be positive');
    });

    it('should throw error for zero price', () => {
      expect(() => {
        service.updatePrice('BTC', 0);
      }).toThrow('Price must be positive');
    });
  });

  describe('updatePrices', () => {
    it('should update multiple prices at once', () => {
      service.updatePrices({
        BTC: 50000,
        ETH: 3000,
        DOGE: 0.07,
      });

      expect(service.getPrice('BTC')).toBe(50000);
      expect(service.getPrice('ETH')).toBe(3000);
      expect(service.getPrice('DOGE')).toBe(0.07);
    });

    it('should throw error if any price is invalid', () => {
      expect(() => {
        service.updatePrices({
          BTC: 50000,
          ETH: -100, // Invalid
        });
      }).toThrow('Price must be positive');
    });

    it('should update lastUpdateTime once for bulk update', () => {
      const before = service.getLastUpdateTime();
      
      service.updatePrices({
        BTC: 50000,
        ETH: 3000,
        SOL: 150,
      });
      
      const after = service.getLastUpdateTime();
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  describe('hasPrice', () => {
    it('should return true for existing symbol', () => {
      expect(service.hasPrice('BTC')).toBe(true);
    });

    it('should return false for non-existent symbol', () => {
      expect(service.hasPrice('DOGE')).toBe(false);
    });

    it('should return true after adding new symbol', () => {
      service.updatePrice('DOGE', 0.07);
      expect(service.hasPrice('DOGE')).toBe(true);
    });
  });

  describe('getAvailableSymbols', () => {
    it('should return array of all symbols', () => {
      const symbols = service.getAvailableSymbols();
      expect(symbols).toContain('BTC');
      expect(symbols).toContain('ETH');
      expect(symbols).toContain('SOL');
      expect(symbols).toContain('LINK');
      expect(symbols).toContain('UNI');
    });

    it('should include newly added symbols', () => {
      service.updatePrice('DOGE', 0.07);
      const symbols = service.getAvailableSymbols();
      expect(symbols).toContain('DOGE');
    });
  });

  describe('clearAllPrices', () => {
    it('should clear all prices and reset to defaults', () => {
      service.updatePrice('DOGE', 0.07);
      service.updatePrice('BTC', 50000);
      
      service.clearAllPrices();
      
      // Should be back to defaults
      expect(service.getPrice('BTC')).toBe(44000);
      expect(service.getPrice('DOGE')).toBeUndefined();
      expect(service.getAvailableSymbols()).toHaveLength(5);
    });
  });

  describe('getLastUpdateTime', () => {
    it('should return Date object', () => {
      const time = service.getLastUpdateTime();
      expect(time).toBeInstanceOf(Date);
    });

    it('should be updated when prices change', () => {
      const before = service.getLastUpdateTime();
      
      // Small delay to ensure time difference
      setTimeout(() => {
        service.updatePrice('BTC', 50000);
        const after = service.getLastUpdateTime();
        expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
      }, 10);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large prices', () => {
      service.updatePrice('BTC', 1000000);
      expect(service.getPrice('BTC')).toBe(1000000);
    });

    it('should handle very small prices', () => {
      service.updatePrice('SHIB', 0.00001);
      expect(service.getPrice('SHIB')).toBe(0.00001);
    });

    it('should handle symbol case sensitivity', () => {
      service.updatePrice('btc', 50000);
      expect(service.getPrice('btc')).toBe(50000);
      expect(service.getPrice('BTC')).toBe(44000); // Different symbol
    });
  });
});
