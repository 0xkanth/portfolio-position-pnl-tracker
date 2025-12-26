import { Module } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { PortfolioQueryService } from './portfolio-query.service';
import { PortfolioStorageService } from './portfolio-storage.service';
import { MarketPriceModule } from '../market-price/market-price.module';

@Module({
  imports: [MarketPriceModule], // Import to access MarketPriceService
  controllers: [PortfolioController],
  providers: [
    PortfolioStorageService,
    PortfolioService,      // Mutations: addTrade, updatePrice, clearAll
    PortfolioQueryService, // Queries: getPortfolio, getPnl, getAllTrades, getMarketPrices
  ],
})
export class PortfolioModule {}
