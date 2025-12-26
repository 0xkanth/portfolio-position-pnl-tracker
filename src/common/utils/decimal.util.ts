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

/**
 * Converts Decimal to USD string with 2 decimal places.
 * Used for P&L amounts and portfolio values.
 */
export function toUSD(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/**
 * Safe addition of Decimal values.
 */
export function add(...values: Decimal[]): Decimal {
  return values.reduce((sum, val) => sum.plus(val), new Decimal(0));
}

/**
 * Safe multiplication.
 */
export function multiply(a: Decimal, b: Decimal): Decimal {
  return a.times(b);
}

/**
 * Safe subtraction.
 */
export function subtract(a: Decimal, b: Decimal): Decimal {
  return a.minus(b);
}

/**
 * Safe division with zero check.
 */
export function divide(a: Decimal, b: Decimal): Decimal {
  if (b.isZero()) {
    throw new Error('Division by zero');
  }
  return a.dividedBy(b);
}
