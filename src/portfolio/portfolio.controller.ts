import { Controller, Get, Post, Body, HttpCode, HttpStatus, Query } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { PortfolioQueryService } from './portfolio-query.service';
import { CreateTradeDto } from './dto/create-trade.dto';
import { TradeResponseDto } from './dto/trade-response.dto';
import { PortfolioResponseDto } from './dto/portfolio-response.dto';
import { PnlResponseDto } from './dto/pnl-response.dto';
import { UpdatePriceDto, BulkUpdatePricesDto } from './dto/update-price.dto';
import { MarketPricesResponseDto } from './dto/market-prices-response.dto';

@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly queryService: PortfolioQueryService,
  ) {}

  /**
   * Records trade execution and updates position state.
   * Idempotent - duplicate tradeId returns 201 with existing record.
   * 
   * POST /portfolio/trades
   * @returns 201 with trade details + duplicate flag
   */
  @Post('trades')
  @HttpCode(HttpStatus.CREATED)
  addTrade(@Body() createTradeDto: CreateTradeDto): TradeResponseDto {
    const existingTrade = this.queryService.getTradeByTradeId(createTradeDto.tradeId);
    
    if (existingTrade) {
      return {
        id: existingTrade.id,
        tradeId: existingTrade.tradeId,
        orderId: existingTrade.orderId,
        symbol: existingTrade.symbol,
        side: existingTrade.side,
        price: existingTrade.price,
        quantity: existingTrade.quantity,
        executionTimestamp: existingTrade.executionTimestamp.toISOString(),
        createdAt: existingTrade.createdAt?.toISOString(),
        message: 'Trade already recorded (idempotent)',
        duplicate: true,
      };
    }

    const trade = this.portfolioService.addTrade(createTradeDto);

    return {
      id: trade.id,
      tradeId: trade.tradeId,
      orderId: trade.orderId,
      symbol: trade.symbol,
      side: trade.side,
      price: trade.price,
      quantity: trade.quantity,
      executionTimestamp: trade.executionTimestamp.toISOString(),
      createdAt: trade.createdAt?.toISOString(),
      message: 'Trade recorded successfully',
      duplicate: false,
    };
  }

  /**
   * Returns current holdings with unrealized P&L.
   * 
   * GET /portfolio/positions?symbol=BTC
   * @param symbol - Optional filter for single position
   */
  @Get('positions')
  @HttpCode(HttpStatus.OK)
  getPortfolio(@Query('symbol') symbol?: string): PortfolioResponseDto {
    return this.queryService.getPortfolio(symbol);
  }

  /**
   * Calculates realized + unrealized P&L.
   * 
   * GET /portfolio/pnl?symbols=BTC,ETH
   * @param symbolsQuery - Comma-separated symbols or omit for all
   */
  @Get('pnl')
  @HttpCode(HttpStatus.OK)
  getPnl(@Query('symbols') symbolsQuery?: string): PnlResponseDto {
    const symbols = symbolsQuery ? symbolsQuery.split(',').map(s => s.trim()) : undefined;
    return this.queryService.getPnl(symbols);
  }

  /**
   * Returns trade history, optionally filtered by symbol.
   * 
   * GET /portfolio/trades?symbol=BTC
   */
  @Get('trades')
  @HttpCode(HttpStatus.OK)
  getAllTrades(@Query('symbol') symbol?: string) {
    return this.queryService.getAllTrades(symbol);
  }

  /**
   * Returns current market prices with last update timestamp.
   * 
   * GET /portfolio/market-prices?symbol=BTC
   */
  @Get('market-prices')
  @HttpCode(HttpStatus.OK)
  getMarketPrices(@Query('symbol') symbol?: string): MarketPricesResponseDto {
    const data = this.queryService.getMarketPrices(symbol);
    return {
      prices: data.prices,
      lastUpdated: data.lastUpdate.toISOString(),
      source: 'manual',
    };
  }

  /**
   * Updates single symbol price for unrealized P&L calc.
   * 
   * POST /portfolio/market-prices/update
   */
  @Post('market-prices/update')
  @HttpCode(HttpStatus.OK)
  updatePrice(@Body() updatePriceDto: UpdatePriceDto) {
    this.portfolioService.updatePrice(updatePriceDto.symbol, updatePriceDto.price);
    return {
      message: `Price updated for ${updatePriceDto.symbol}`,
      symbol: updatePriceDto.symbol,
      price: updatePriceDto.price,
    };
  }

  /**
   * Batch updates market prices across multiple symbols.
   * 
   * POST /portfolio/market-prices/bulk
   */
  @Post('market-prices/bulk')
  @HttpCode(HttpStatus.OK)
  bulkUpdatePrices(@Body() bulkUpdatePricesDto: BulkUpdatePricesDto) {
    this.portfolioService.updatePrices(bulkUpdatePricesDto.prices);
    return {
      message: 'Market prices updated',
      updatedSymbols: Object.keys(bulkUpdatePricesDto.prices),
      prices: bulkUpdatePricesDto.prices,
    };
  }

  /**
   * Clears all state - test harness only.
   * 
   * POST /portfolio/reset
   */
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  reset() {
    this.portfolioService.clearAll();
    return { message: 'Portfolio reset successfully' };
  }
}
