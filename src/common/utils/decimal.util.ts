import Decimal from 'decimal.js';

// Configure Decimal.js globally for financial precision
Decimal.set({
  precision: 20,           // 20 significant digits
  rounding: Decimal.ROUND_HALF_UP,  // Banker's rounding
  toExpPos: 9e15,         // No exponential notation for large numbers
  toExpNeg: -9e15,        // No exponential notation for small numbers
});

/**
 * Converts any number-like value to Decimal for financial calculations.
 * Handles JavaScript numbers, strings, and existing Decimal instances.
 */
export function toDecimal(value: number | string | Decimal): Decimal {
  return new Decimal(value);
}

/**
 * Converts Decimal back to JavaScript number for JSON serialization.
 * Rounds to 8 decimal places (standard crypto precision).
 */
export function toNumber(value: Decimal): number {
  return value.toDecimalPlaces(8).toNumber();
}


