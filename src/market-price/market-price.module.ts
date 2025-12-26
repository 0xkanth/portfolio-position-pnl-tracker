import { Module } from '@nestjs/common';
import { MarketPriceService } from './market-price.service';

@Module({
  providers: [MarketPriceService],
  exports: [MarketPriceService],
})
export class MarketPriceModule {}
