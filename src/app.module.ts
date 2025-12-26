import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PortfolioModule } from './portfolio/portfolio.module';

@Module({
  imports: [PortfolioModule],
  controllers: [AppController],
})
export class AppModule {}
