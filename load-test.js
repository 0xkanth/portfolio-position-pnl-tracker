#!/usr/bin/env node

// load test - measures API latency under realistic load
// runs 3 phases: warmup, sustained, spike
// tracks p50/p95/p99 latencies per endpoint

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:3000';
const SYMBOLS = ['BTC', 'ETH', 'SOL', 'LINK', 'UNI'];

const COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  LINK: 'chainlink',
  UNI: 'uniswap',
};

const FALLBACK_PRICES = {
  BTC: 44000,
  ETH: 2500,
  SOL: 100,
  LINK: 14,
  UNI: 5,
};

let livePrices = { ...FALLBACK_PRICES };

const CONFIG = {
  warmupDuration: 5000,
  warmupRps: 10,
  
  loadTestDuration: 30000,
  tradesPerSecond: 50,
  readRps: 100,
  
  spikeDuration: 5000,
  spikeTradesPerSecond: 200,
  spikeReadRps: 400,
};

const metrics = {
  addTrade: [],
  getPortfolio: [],
  getPnl: [],
  updatePrices: [],
  errors: {
    addTrade: 0,
    getPortfolio: 0,
    getPnl: 0,
    updatePrices: 0,
  },
  totalRequests: 0,
  successfulRequests: 0,
};

// Track positions to avoid overselling
const positions = {};
SYMBOLS.forEach(symbol => positions[symbol] = 0);

async function fetchLivePrices() {
  return new Promise((resolve) => {
    const coinIds = Object.values(COINGECKO_IDS).join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=usd`;
    
    console.log('Fetching live prices from CoinGecko...');
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => data += chunk);
      
      res.on('end', () => {
        try {
          const prices = JSON.parse(data);
          
          // Map CoinGecko response to our symbols
          Object.entries(COINGECKO_IDS).forEach(([symbol, coinId]) => {
            if (prices[coinId] && prices[coinId].usd) {
              livePrices[symbol] = prices[coinId].usd;
            }
          });
          
          console.log('[OK] Live prices fetched:');
          Object.entries(livePrices).forEach(([symbol, price]) => {
            console.log(`   ${symbol}: $${price.toLocaleString()}`);
          });
          console.log('');
          
          resolve(true);
        } catch (error) {
          console.warn('[WARN]  Failed to parse CoinGecko response, using fallback prices');
          console.log('');
          resolve(false);
        }
      });
    }).on('error', (error) => {
      console.warn('[WARN]  Failed to fetch from CoinGecko, using fallback prices');
      console.warn(`   Error: ${error.message}`);
      console.log('');
      resolve(false);
    });
  });
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve) => {
    const startTime = process.hrtime.bigint();
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const endTime = process.hrtime.bigint();
        const latencyMs = Number(endTime - startTime) / 1_000_000;
        
        metrics.totalRequests++;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          metrics.successfulRequests++;
          resolve({ success: true, latency: latencyMs, status: res.statusCode });
        } else {
          resolve({ success: false, latency: latencyMs, status: res.statusCode, error: data });
        }
      });
    });
    
    req.on('error', (error) => {
      const endTime = process.hrtime.bigint();
      const latencyMs = Number(endTime - startTime) / 1_000_000;
      metrics.totalRequests++;
      resolve({ success: false, latency: latencyMs, error: error.message });
    });
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function generateTrade() {
  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const currentPosition = positions[symbol] || 0;
  
  // 70% buy, 30% sell (only if we have inventory)
  const side = (currentPosition > 0 && Math.random() > 0.7) ? 'sell' : 'buy';
  
  const basePrice = livePrices[symbol] || FALLBACK_PRICES[symbol];
  const priceVariation = basePrice * (0.95 + Math.random() * 0.1);
  
  let quantity;
  if (side === 'sell') {
    // Sell max 50% of current position
    quantity = Math.min(currentPosition * 0.5, Math.random() * 5 + 1);
  } else {
    quantity = Math.random() * 10 + 1;
  }
  
  return {
    tradeId: `load-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    orderId: `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    symbol,
    side,
    price: Number(priceVariation.toFixed(2)),
    quantity: Number(quantity.toFixed(4)),
    executionTimestamp: new Date().toISOString(),
  };
}

async function addTrade() {
  const trade = generateTrade();
  const result = await makeRequest('POST', '/portfolio/trades', trade);
  
  if (result.success) {
    metrics.addTrade.push(result.latency);
    // Update local position tracking
    if (trade.side === 'buy') {
      positions[trade.symbol] = (positions[trade.symbol] || 0) + trade.quantity;
    } else {
      positions[trade.symbol] = (positions[trade.symbol] || 0) - trade.quantity;
    }
  } else {
    metrics.errors.addTrade++;
  }
  
  return result;
}

async function getPortfolio() {
  const result = await makeRequest('GET', '/portfolio/positions');
  
  if (result.success) {
    metrics.getPortfolio.push(result.latency);
  } else {
    metrics.errors.getPortfolio++;
  }
  
  return result;
}

async function getPnl() {
  const result = await makeRequest('GET', '/portfolio/pnl');
  
  if (result.success) {
    metrics.getPnl.push(result.latency);
  } else {
    metrics.errors.getPnl++;
  }
  
  return result;
}

async function updatePrices() {
  const prices = {};
  SYMBOLS.forEach(symbol => {
    const basePrice = livePrices[symbol] || FALLBACK_PRICES[symbol];
    prices[symbol] = Number((basePrice * (0.98 + Math.random() * 0.04)).toFixed(2));
  });
  
  const result = await makeRequest('POST', '/portfolio/market-prices/bulk', { prices });
  
  if (result.success) {
    metrics.updatePrices.push(result.latency);
  } else {
    metrics.errors.updatePrices++;
  }
  
  return result;
}

function calculatePercentile(arr, percentile) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function calculateStats(arr, name) {
  if (arr.length === 0) {
    return { name, count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, p99_9: 0 };
  }
  
  const sum = arr.reduce((a, b) => a + b, 0);
  const avg = sum / arr.length;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  
  return {
    name,
    count: arr.length,
    min: min.toFixed(2),
    max: max.toFixed(2),
    avg: avg.toFixed(2),
    p50: calculatePercentile(arr, 50).toFixed(2),
    p95: calculatePercentile(arr, 95).toFixed(2),
    p99: calculatePercentile(arr, 99).toFixed(2),
    p99_9: calculatePercentile(arr, 99.9).toFixed(2),
  };
}

async function runLoadPhase(name, duration, tradesPerSec, readsPerSec) {
  console.log(`\n ${name} - Duration: ${duration/1000}s, Trades/sec: ${tradesPerSec}, Reads/sec: ${readsPerSec}`);
  
  const startTime = Date.now();
  const tradeInterval = 1000 / tradesPerSec;
  const readInterval = 1000 / readsPerSec;
  
  const promises = [];
  
  const tradeTimer = setInterval(() => {
    if (Date.now() - startTime >= duration) {
      clearInterval(tradeTimer);
      return;
    }
    promises.push(addTrade());
  }, tradeInterval);
  
  const readTimer = setInterval(() => {
    if (Date.now() - startTime >= duration) {
      clearInterval(readTimer);
      return;
    }
    
    const operation = Math.random();
    if (operation < 0.5) {
      promises.push(getPortfolio());
    } else if (operation < 0.95) {
      promises.push(getPnl());
    } else {
      promises.push(updatePrices());
    }
  }, readInterval);
  
  await new Promise(resolve => setTimeout(resolve, duration));
  clearInterval(tradeTimer);
  clearInterval(readTimer);
  
  await Promise.all(promises);
  
  console.log(`[OK] ${name} complete`);
}

function printResults() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('                    LOAD TEST RESULTS                                  ');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('');
  
  const totalDuration = CONFIG.warmupDuration + CONFIG.loadTestDuration + CONFIG.spikeDuration;
  const successRate = ((metrics.successfulRequests / metrics.totalRequests) * 100).toFixed(2);
  
  console.log('OVERALL STATISTICS');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(`Total Requests:      ${metrics.totalRequests.toLocaleString()}`);
  console.log(`Successful:          ${metrics.successfulRequests.toLocaleString()} (${successRate}%)`);
  console.log(`Failed:              ${(metrics.totalRequests - metrics.successfulRequests).toLocaleString()}`);
  console.log(`Duration:            ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`Throughput:          ${(metrics.totalRequests / (totalDuration / 1000)).toFixed(0)} req/sec`);
  console.log('');
  
  console.log('LATENCY PERCENTILES (milliseconds)');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('Endpoint          Count    Min      Avg      p50      p95      p99      p99.9    Max');
  console.log('─────────────────────────────────────────────────────────────────────');
  
  const stats = [
    calculateStats(metrics.addTrade, 'POST /trades'),
    calculateStats(metrics.getPortfolio, 'GET /positions'),
    calculateStats(metrics.getPnl, 'GET /pnl'),
    calculateStats(metrics.updatePrices, 'PUT /prices'),
  ];
  
  stats.forEach(s => {
    if (s.count > 0) {
      console.log(
        `${s.name.padEnd(16)} ${String(s.count).padStart(6)} ${String(s.min).padStart(8)} ${String(s.avg).padStart(8)} ${String(s.p50).padStart(8)} ${String(s.p95).padStart(8)} ${String(s.p99).padStart(8)} ${String(s.p99_9).padStart(8)} ${String(s.max).padStart(8)}`
      );
    }
  });
  
  console.log('');
  
  const totalErrors = Object.values(metrics.errors).reduce((a, b) => a + b, 0);
  if (totalErrors > 0) {
    console.log('[ERROR] ERRORS BY ENDPOINT');
    console.log('─────────────────────────────────────────────────────────────────────');
    Object.entries(metrics.errors).forEach(([endpoint, count]) => {
      if (count > 0) {
        console.log(`${endpoint.padEnd(20)} ${count}`);
      }
    });
    console.log('');
  }
  
  console.log('PERFORMANCE VERDICT');
  console.log('─────────────────────────────────────────────────────────────────────');
  
  const avgTradeLatency = parseFloat(calculateStats(metrics.addTrade, '').avg);
  const p99TradeLatency = parseFloat(calculateStats(metrics.addTrade, '').p99);
  const avgReadLatency = parseFloat(calculateStats(metrics.getPnl, '').avg);
  const p99ReadLatency = parseFloat(calculateStats(metrics.getPnl, '').p99);
  
  console.log(`Write Performance:   ${avgTradeLatency < 10 ? '[OK]' : avgTradeLatency < 50 ? '[WARN]' : '[ERROR]'} Avg: ${avgTradeLatency.toFixed(2)}ms (Target: <10ms)`);
  console.log(`Write p99:           ${p99TradeLatency < 50 ? '[OK]' : p99TradeLatency < 100 ? '[WARN]' : '[ERROR]'} ${p99TradeLatency.toFixed(2)}ms (Target: <50ms)`);
  console.log(`Read Performance:    ${avgReadLatency < 5 ? '[OK]' : avgReadLatency < 20 ? '[WARN]' : '[ERROR]'} Avg: ${avgReadLatency.toFixed(2)}ms (Target: <5ms)`);
  console.log(`Read p99:            ${p99ReadLatency < 20 ? '[OK]' : p99ReadLatency < 50 ? '[WARN]' : '[ERROR]'} ${p99ReadLatency.toFixed(2)}ms (Target: <20ms)`);
  console.log(`Success Rate:        ${successRate >= 99.9 ? '[OK]' : successRate >= 99 ? '[WARN]' : '[ERROR]'} ${successRate}% (Target: >99.9%)`);
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════════════════════');
}

async function main() {
  console.log('Portfolio Tracker - Load Testing');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Configuration:');
  console.log(`  Warmup:       ${CONFIG.warmupDuration/1000}s @ ${CONFIG.warmupRps} req/s`);
  console.log(`  Load Test:    ${CONFIG.loadTestDuration/1000}s @ ${CONFIG.tradesPerSecond + CONFIG.readRps} req/s`);
  console.log(`  Spike Test:   ${CONFIG.spikeDuration/1000}s @ ${CONFIG.spikeTradesPerSecond + CONFIG.spikeReadRps} req/s`);
  console.log(`  Symbols:      ${SYMBOLS.join(', ')}`);
  console.log('');
  
  await fetchLivePrices();
  
  console.log('Checking server health...');
  const health = await makeRequest('GET', '/health');
  if (!health.success) {
    console.error('[ERROR] Server is not responding. Please start the server with: npm run start:dev');
    process.exit(1);
  }
  console.log('[OK] Server is healthy');
  
  console.log('Clearing existing data...');
  await makeRequest('POST', '/portfolio/reset');
  
  await runLoadPhase('Phase 1: Warmup', CONFIG.warmupDuration, CONFIG.warmupRps / 2, CONFIG.warmupRps / 2);
  await runLoadPhase('Phase 2: Sustained Load', CONFIG.loadTestDuration, CONFIG.tradesPerSecond, CONFIG.readRps);
  await runLoadPhase('Phase 3: Spike Test', CONFIG.spikeDuration, CONFIG.spikeTradesPerSecond, CONFIG.spikeReadRps);
  
  printResults();
}

main().catch(err => {
  console.error('[ERROR] Load test failed:', err);
  process.exit(1);
});
