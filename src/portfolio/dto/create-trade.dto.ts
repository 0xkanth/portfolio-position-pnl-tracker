import { IsEnum, IsNumber, IsPositive, IsString, IsNotEmpty, IsDateString } from 'class-validator';
import { TradeSide } from '../entities/trade.entity';

// DTO for recording a trade that's already executed.
// tradeId is the idempotency key (prevents duplicates).
export class CreateTradeDto {
  @IsString()
  @IsNotEmpty()
  tradeId: string;

  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsEnum(TradeSide)
  side: TradeSide;

  @IsNumber()
  @IsPositive()
  price: number;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsDateString()
  executionTimestamp: string;
}
