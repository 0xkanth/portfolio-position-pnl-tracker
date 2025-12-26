import { Controller, Get } from '@nestjs/common';
import { HealthResponse } from './common/interfaces/health.interface';

@Controller()
export class AppController {
  /**
   * Health check for load balancers and monitoring.
   * 
   * GET /health
   */
  @Get('health')
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      service: 'portfolio-tracker',
    };
  }

  /**
   * API root - returns service info and available endpoints.
   * 
   * GET /
   */
  @Get()
  getRoot() {
    return {
      message: 'Portfolio & PnL Tracker API',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        trades: '/portfolio/trades',
        positions: '/portfolio/positions',
        pnl: '/portfolio/pnl',
      },
    };
  }
}
