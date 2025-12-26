# Cleanup: Remove unused decimal helpers and add realistic test scenarios

## What Changed

Cleaned up decimal utility code and updated tests/docs to use realistic crypto prices with mixed precision.

## Changes

### Code Cleanup
- **decimal.util.ts**: Removed unused helper functions (toUSD, add, multiply, subtract, divide)
  - Kept only `toDecimal()` and `toNumber()` - that's all we actually use
  - Reduced file from 65 lines to 26 lines
  
- **Service comments**: Stripped verbose JSDoc blocks down to concise inline comments
  - portfolio.service.ts, portfolio-query.service.ts, portfolio-storage.service.ts
  - Example: Multi-line JSDoc → `// Records trade and updates position state. Idempotent.`

- **Entity comments**: Updated to emphasize Decimal precision (20 sig digits)

- **Query service**: Changed `Number()` to `parseFloat()` for consistency

### Tests
- **Added 7 new decimal precision test cases** in portfolio.service.spec.ts:
  - High-precision: 0.00123456 BTC @ $43,234.567891 → sell @ $45,678.912345 (P&L: $3.02)
  - Mixed decimals: combining clean values (1.5, 3000) with messy (2987.654321, 43234.567891)
  - Micro-amounts: 0.00000001 BTC @ $87,250.123456
  - Accumulated P&L across multiple mixed-precision trades
  - Negative P&L scenarios (-$630.17)
  - Multiple FIFO lot matches with varying precision

- All assertions use `.toBeCloseTo()` instead of `.toBe()` for proper float comparison

### Documentation
- **README.md**: Updated all examples with realistic mixed-precision values
  - API examples: Both messy (43234.567891, 0.00123456) and clean (2987.65, 1.5) decimals
  - Quick Start: curl examples with high-precision trades
  - P&L Calculation section: Real-world crypto scenarios
  - Portfolio responses: Realistic quantities and prices
  - Market price updates: Mixed precision throughout

- **test-comprehensive.sh**: Added TEST 1 with mixed decimal precision scenario
  - Buy: 0.00123456 BTC @ $43,234.567891
  - Sell: Shows exact P&L = $3.02
  - Contrasts with clean ETH trade (1.5 @ $2,987.65)

## Why

Old examples used round numbers (40000, 42000, 45000) that don't represent real crypto trading. New examples show how Decimal.js handles both clean and messy decimals correctly - satoshi-level precision, typical exchange prices, fractional quantities.

## Testing

All 69 unit tests pass. Test coverage unchanged.

```bash
npm test
# ✓ 69 tests passing
```

## Notes

- No functional changes, just cleanup and better examples
- Decimal.js config stays the same: 20 sig digits, ROUND_HALF_UP, 8 decimal precision
- toFixed(2) still used for USD display formatting
