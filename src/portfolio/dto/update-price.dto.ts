import { IsString, IsNumber, IsPositive, IsNotEmpty, IsObject } from 'class-validator';

// Update price for a single symbol
export class UpdatePriceDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsNumber()
  @IsPositive()
  price: number;
}

// Update prices for multiple symbols at once
export class BulkUpdatePricesDto {
  @IsObject()
  prices: Record<string, number>;  // { "BTC": 50000, "ETH": 3000 }
}
