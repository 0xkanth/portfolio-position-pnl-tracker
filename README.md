# Portfolio & PnL Tracker

Crypto portfolio tracker with FIFO accounting, CQRS pattern, and P&L calculations.

**Quick Links**: 
- [Architecture](#architecture) 
- [API Docs](#api) 
- [Quick Start](#quick-start) 
- [Testing](#testing)

## Approach & Assumptions

### Design Approach

**FIFO Accounting**: First-In-First-Out lot matching for cost basis tracking. Sells consume oldest lots first.

**CQRS Pattern**: Separate write (PortfolioService) and read (PortfolioQueryService) paths. Writes handle FIFO matching; reads use pre-computed aggregates.

**Performance**: Cached realized P&L aggregates for O(1) queries. Unrealized P&L computed on-demand.

**Idempotency**: `tradeId` prevents duplicate processing.

### Assumptions

| Assumption | Current | Production |
|------------|---------|------------|
| **Storage** | In-memory | PostgreSQL/TimescaleDB |
| **Users** | Single user | Multi-tenant with JWT auth |
| **Prices** | Manual API updates | WebSocket feeds (Binance/Coinbase) |
| **Precision** | JavaScript `number` | `Decimal.js` for >$10M portfolios |
| **Symbols** | Uppercase (BTC, ETH) | Normalized + validated |
| **Positions** | Long only | No short selling support |

### Stack: 
- NestJS 10 
- TypeScript 5 
- Jest 
- Docker

## Architecture

```mermaid
graph LR
    Client[HTTP Client]
    
    subgraph API Layer
        Controller[PortfolioController<br/>Validation]
    end
    
    subgraph Business Logic
        WriteService[PortfolioService<br/>FIFO + Writes]
        ReadService[PortfolioQueryService<br/>Reads]
        PriceService[MarketPriceService]
    end
    
    subgraph Data Layer
        Storage[PortfolioStorageService<br/>In-Memory Maps]
        Cache[Aggregates Cache]
    end
    
    Client -->|REST API| Controller
    Controller -->|Writes| WriteService
    Controller -->|Reads| ReadService
    WriteService -->|FIFO Match| Storage
    ReadService -->|Query| Storage
    Storage -->|Cache| Cache
```

### Design Principles

**CQRS Pattern**: Separate write (PortfolioService) and read (PortfolioQueryService) paths for independent optimization.

**Performance-First Data Structures**:
```typescript
tradeIdIndex: Map<tradeId, Trade>           // O(1) idempotency check
positions: Map<symbol, Position>             // O(1) position lookup
realizedPnlAggregates: Map<symbol, Aggregate> // O(1) cached PnL totals
```

## Data Model

### Entity Relationship Diagram

```mermaid
erDiagram
    Trade ||--o{ Position : "updates"
    Position ||--|{ FifoLot : "contains"
    Trade ||--o{ RealizedPnlRecord : "creates (on SELL)"
    Position ||--|| RealizedPnlAggregate : "has cached aggregate"
    
    Trade {
        string id "System-generated UUID"
        string tradeId "External broker ID, idempotency key"
        string orderId "Parent order reference"
        string symbol "Asset being traded (BTC, ETH, etc)"
        enum side "buy or sell direction"
        number price "Execution price per unit"
        number quantity "Number of units traded"
        date executionTimestamp "Exchange execution time"
        date createdAt "System ingestion time"
    }
    
    Position {
        string symbol "Asset identifier, primary key, ONE per symbol"
        number totalQuantity "Current holdings, sum of all lots"
        number averageEntryPrice "Weighted average cost basis"
        FifoLot[] fifoQueue "Array of buy lots, oldest first at index 0"
    }
    
    FifoLot {
        number quantity "Remaining amount in this lot"
        number price "Original purchase price, cost basis"
        string tradeId "Originating buy trade identifier"
    }
    
    RealizedPnlRecord {
        string symbol "Asset that was sold"
        number quantity "Amount closed in this record"
        number buyPrice "Purchase price from matched FIFO lot"
        number sellPrice "Sale price from SELL trade"
        number pnl "Computed profit/loss: (sell - buy) × qty"
        date timestamp "When P&L was realized"
    }
    
    RealizedPnlAggregate {
        string symbol "Asset identifier, primary key"
        number totalPnl "Sum of all realized P&L records"
        number totalQuantity "Total closed quantity across all time"
    }
```

**Relationships**:
- Position ↔ Symbol: ONE per symbol
- BUY Trade: Creates one FifoLot
- SELL Trade: Consumes N lots, creates N RealizedPnlRecords
- RealizedPnlAggregate: Cached totals for O(1) reads

**Storage Maps** (O(1) lookups):

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `tradeIdIndex` | `tradeId` | `Trade` | Idempotency check |
| `positions` | `symbol` | `Position` | Current holdings + FIFO queue |
| `realizedPnlRecords` | `symbol` | `RealizedPnlRecord[]` | Audit trail |
| `realizedPnlAggregates` | `symbol` | `Aggregate` | Cached P&L totals |

**Trade Behavior**:
- **BUY**: Appends new lot to position's FIFO queue
- **SELL**: Consumes lots from queue front (oldest first)

**Example State**:
```typescript
positions.get("BTC") = {
  symbol: "BTC",
  totalQuantity: 5,
  fifoQueue: [
    {qty: 2, price: 40000, tradeId: "t1"},  // oldest
    {qty: 3, price: 42000, tradeId: "t2"}   // newest
  ]
}
```

### Domain Entities

| Entity | Purpose | Key Concept |
|--------|---------|-------------|
| **Trade** | Immutable trade record | Idempotency via `tradeId` |
| **Position** | Current holdings per symbol | FIFO queue + weighted avg cost |
| **RealizedPnlRecord** | Locked-in P&L per lot match | Tax audit trail |
| **RealizedPnlAggregate** | Cached P&L totals | O(1) query performance |

### API DTOs

| DTO | Endpoint | Purpose | Key Fields |
|-----|----------|---------|------------|
| **CreateTradeDto** | `POST /trades` | Validate trade input | `tradeId`, `symbol`, `side`, `price`, `quantity` |
| **PortfolioResponseDto** | `GET /positions` | Holdings + unrealized P&L | `positions[]`, `totalValue`, `totalUnrealizedPnl` |
| **PnlResponseDto** | `GET /pnl` | Complete P&L breakdown | `realizedPnl[]`, `unrealizedPnl[]`, `netPnl` |

---

### Data Flow Example

**Scenario**: Buy 2 BTC @ \$40k, Buy 3 BTC @ \$42k, then Sell 4 BTC @ \$45k

#### Step 1: BUY 2 BTC @ \$40,000

Creates new position:
```typescript
{
  symbol: "BTC",
  totalQty: 2,
  avgEntry: 40000,
  fifoQueue: [{qty: 2, price: 40000, tradeId: "t1"}]
}
```

#### Step 2: BUY 3 BTC @ \$42,000

Appends to FIFO queue, recalculates weighted average:
```typescript
{
  symbol: "BTC",
  totalQty: 5,
  avgEntry: 41200,  // (2×40k + 3×42k) / 5
  fifoQueue: [
    {qty: 2, price: 40000, tradeId: "t1"},  // oldest
    {qty: 3, price: 42000, tradeId: "t2"}   // newest
  ]
}
```

#### Step 3: SELL 4 BTC @ \$45,000

FIFO matching consumes from queue front:

| Match | Lot Consumed | PnL Calculation | Result |
|-------|--------------|-----------------|--------|
| 1 | 2 BTC @ \$40k (entire lot) | (45k - 40k) × 2 | \$10,000 |
| 2 | 2 of 3 BTC @ \$42k (partial) | (45k - 42k) × 2 | \$6,000 |

**Total Realized PnL**: \$16,000 (cached in aggregate)

**Remaining Position**:
```typescript
{
  symbol: "BTC",
  totalQty: 1,
  avgEntry: 42000,
  fifoQueue: [{qty: 1, price: 42000, tradeId: "t2"}]
}
```

#### Step 4: GET /portfolio/positions

Query computes unrealized PnL using current market price:

| Position | Avg Entry | Current Price | Calculation | Unrealized PnL |
|----------|-----------|---------------|-------------|----------------|
| 1 BTC | \$42,000 | \$44,000 | (44k - 42k) × 1 | \$2,000 |

#### Step 5: GET /portfolio/pnl

Returns complete P&L breakdown:

```json
{
  "realizedPnl": [{"symbol": "BTC", "realizedPnl": 16000}],
  "unrealizedPnl": [{"symbol": "BTC", "unrealizedPnl": 2000}],
  "netPnl": 18000
}
```

---

## FIFO Engine

### Write Path

```mermaid
sequenceDiagram
    participant Client as HTTP Client
    participant Controller as PortfolioController<br/>(portfolio.controller.ts)
    participant Service as PortfolioService<br/>(portfolio.service.ts)
    participant Storage as PortfolioStorageService<br/>(portfolio-storage.service.ts)
    
    Client->>Controller: POST /portfolio/trades<br/>{side: "sell", quantity: 4, price: 45000}
    Controller->>Controller: Validate CreateTradeDto
    Controller->>Service: addTrade(dto)
    
    Service->>Service: Check idempotency<br/>(tradeIdIndex.has(tradeId))
    Service->>Storage: getPosition(symbol)
    Storage-->>Service: Position {fifoQueue: [2@40k, 3@42k]}
    
    Note over Service: processSellTrade()<br/>(portfolio.service.ts:L127)
    
    Service->>Service: Match lot 1: 2 BTC @ $40k<br/>PnL = (45k-40k)×2 = $10k
    Service->>Storage: addRealizedPnlRecord()<br/>(RealizedPnlRecord entity)
    Service->>Storage: updateRealizedPnlAggregate()<br/>(Map: symbol → aggregate)
    
    Service->>Service: Match lot 2: 2 of 3 BTC @ $42k<br/>PnL = (45k-42k)×2 = $6k
    Service->>Storage: addRealizedPnlRecord()
    Service->>Storage: updateRealizedPnlAggregate()
    
    Service->>Storage: updatePosition()<br/>(new queue: [1@42k])
    Service->>Storage: addTrade(trade)
    
    Storage-->>Service: Trade saved
    Service-->>Controller: TradeResponseDto
    Controller-->>Client: 201 Created<br/>{message: "Trade recorded", realizedPnl: 16000}
```

### Read Path: Portfolio Query

```mermaid
sequenceDiagram
    participant Client as HTTP Client
    participant Controller as PortfolioController<br/>(portfolio.controller.ts)
    participant QueryService as PortfolioQueryService<br/>(portfolio-query.service.ts)
    participant Storage as PortfolioStorageService<br/>(portfolio-storage.service.ts)
    participant PriceService as MarketPriceService<br/>(market-price.service.ts)
    
    Client->>Controller: GET /portfolio/pnl
    Controller->>QueryService: getPnl()
    
    Note over QueryService: getPnl()<br/>(portfolio-query.service.ts:L78)
    
    QueryService->>Storage: getRealizedPnlAggregates()
    Storage-->>QueryService: Map<symbol, {totalPnl, closedQty}>
    Note over QueryService: O(1) cached lookup
    
    QueryService->>Storage: getAllPositions()
    Storage-->>QueryService: Map<symbol, Position>
    
    loop For each position
        QueryService->>PriceService: getPrice(symbol)
        PriceService-->>QueryService: currentPrice
        QueryService->>QueryService: Calculate unrealized PnL<br/>(price - avgEntry) × quantity
    end
    
    QueryService->>QueryService: Build PnlResponseDto<br/>(pnl-response.dto.ts)
    QueryService-->>Controller: {realized, unrealized, netPnl}
    Controller-->>Client: 200 OK + JSON
```

### P&L Calculation Details

#### 1. Realized P&L (Locked-In)

Permanent profit/loss from closed positions. Computed during SELL execution via FIFO lot matching.

**Formula** (per matched lot):

$$
\text{Realized PnL}_{\text{lot}} = (\text{Sell Price} - \text{Lot Buy Price}) \times \text{Lot Quantity}
$$

**Example**: Selling 4 BTC @ \$45k against queue [2 BTC @ \$40k, 3 BTC @ \$42k]

| Match | Calculation | P&L |
|-------|-------------|-----|
| Lot 1 (2 BTC @ \$40k) | (45k - 40k) × 2 | \$10,000 |
| Lot 2 (2 of 3 BTC @ \$42k) | (45k - 42k) × 2 | \$6,000 |
| **Total** | | **\$16,000** |

---

#### 2. Unrealized P&L (Mark-to-Market)

Floating profit/loss on open positions. Recomputed on-demand during READ operations.

**Formula** (per position):

$$
\text{Unrealized PnL} = (\text{Current Market Price} - \text{Average Entry Price}) \times \text{Total Quantity Held}
$$

**Example**: Hold 1 BTC with \$42k average entry

| Current Price | Calculation | Unrealized P&L |
|---------------|-------------|----------------|
| \$44,000 | (44k - 42k) × 1 | \$2,000 |
| \$41,000 | (41k - 42k) × 1 | -\$1,000 (loss) |

---

#### 3. Average Entry Price

Weighted average price across all buy lots in current position.

**Formula**:

$$
\text{Average Entry Price} = \frac{\sum_{i=1}^{n} (\text{Lot}_i.\text{price} \times \text{Lot}_i.\text{quantity})}{\text{Total Quantity Held}}
$$

**Example**: After BUY 2 BTC @ \$40k, BUY 3 BTC @ \$42k

$$
\text{Average Entry} = \frac{(40{,}000 \times 2) + (42{,}000 \times 3)}{5} = \$41{,}200
$$

After selling 4 BTC, remaining 1 BTC from second lot:

$$
\text{Average Entry} = \$42{,}000
$$

**Properties**: Recalculated after every BUY, cached for fast reads, only includes current FIFO queue lots.

---

#### 4. Net P&L (Total Performance)

**Formula**:

$$
\text{Net PnL} = \text{Total Realized PnL} + \text{Total Unrealized PnL}
$$

**Example**: Realized \$16k + Unrealized \$2k = **Net \$18k**

---

### Edge Cases

| Scenario | Handling | Impact |
|----------|----------|--------|
| **Partial Lot** | Sell < oldest lot → updates lot in-place (e.g., 5 BTC → 3 BTC remaining) | Preserves cost basis |
| **Multi-Lot Match** | Sell spans multiple lots → creates separate PnL record per lot | Tax audit trail |
| **Fractional Amounts** | JavaScript `number` supports 8+ decimals (e.g., 0.5 BTC, 1.75 BTC) | Safe for MVP; use `Decimal.js` for >\$10M portfolios |
| **Overselling** | Validates balance before execution → HTTP 400 if insufficient | No short positions |
| **Zero Position** | Selling entire position → removes from Map, P&L history persists | Clean memory |
| **Missing Prices** | No current price → skips unrealized PnL for that symbol | Graceful degradation |

---


## API Reference

Base URL: `http://localhost:3000`

### Trade Management

#### Add Trade

**POST**

http://localhost:3000/portfolio/trades

Record a new trade with FIFO accounting. Idempotent via `tradeId`.

**Request**:
```json
{
  "tradeId": "t1",
  "orderId": "o1",
  "symbol": "BTC",
  "side": "buy",
  "price": 40000,
  "quantity": 2,
  "executionTimestamp": "2024-01-15T10:00:00Z"
}
```

**Response** `201 Created`:
```json
{
  "id": "2bb2ecb6-ae52-4012-a853-005eadab2e9f",
  "tradeId": "t1",
  "symbol": "BTC",
  "side": "buy",
  "price": 40000,
  "quantity": 2,
  "message": "Trade recorded successfully",
  "duplicate": false
}
```

### Portfolio Queries

#### Get Portfolio Positions

**GET**

http://localhost:3000/portfolio/positions

Returns current holdings with unrealized P&L. Without parameters, returns ALL symbols.

**Query Parameters**:
- `symbol` (optional): Filter by single symbol
- `symbols` (optional): Filter by comma-separated list

**Example URLs**:
- All symbols: http://localhost:3000/portfolio/positions
- Single symbol: http://localhost:3000/portfolio/positions?symbol=BTC
- Multiple symbols: http://localhost:3000/portfolio/positions?symbols=BTC,ETH

**Response** `200 OK` (all symbols):
```json
{
  "positions": [
    {
      "symbol": "BTC",
      "totalQuantity": 1,
      "averageEntryPrice": 40000,
      "currentPrice": 45000,
      "currentValue": 45000,
      "unrealizedPnl": 5000
    },
    {
      "symbol": "ETH",
      "totalQuantity": 5,
      "averageEntryPrice": 2800,
      "currentPrice": 3000,
      "currentValue": 15000,
      "unrealizedPnl": 1000
    },
    {
      "symbol": "SOL",
      "totalQuantity": 10,
      "averageEntryPrice": 90,
      "currentPrice": 100,
      "currentValue": 1000,
      "unrealizedPnl": 100
    }
  ],
  "totalValue": 61000,
  "totalUnrealizedPnl": 6100
}
```

**Filtered Response** `200 OK` (`?symbol=ETH`):
```json
{
  "positions": [
    {
      "symbol": "ETH",
      "totalQuantity": 5,
      "averageEntryPrice": 2800,
      "currentPrice": 3000,
      "currentValue": 15000,
      "unrealizedPnl": 1000
    }
  ],
  "totalValue": 15000,
  "totalUnrealizedPnl": 1000
}
```

#### Get P&L Breakdown

**GET**

http://localhost:3000/portfolio/pnl

Complete P&L breakdown with realized (locked-in) and unrealized (mark-to-market). Without parameters, returns ALL symbols.

**Query Parameters**:
- `symbols` (optional): Comma-separated list to filter

**Example URLs**:
- All symbols: http://localhost:3000/portfolio/pnl
- Filtered: http://localhost:3000/portfolio/pnl?symbols=BTC,ETH
- Single symbol: http://localhost:3000/portfolio/pnl?symbols=SOL

**Response** `200 OK` (all symbols):
```json
{
  "realizedPnl": [
    {
      "symbol": "BTC",
      "realizedPnl": 5000,
      "closedQuantity": 1
    }
  ],
  "unrealizedPnl": [
    {
      "symbol": "BTC",
      "unrealizedPnl": 5000,
      "currentQuantity": 1,
      "averageEntryPrice": 40000,
      "currentPrice": 45000
    },
    {
      "symbol": "ETH",
      "unrealizedPnl": 1000,
      "currentQuantity": 5,
      "averageEntryPrice": 2800,
      "currentPrice": 3000
    },
    {
      "symbol": "SOL",
      "unrealizedPnl": 100,
      "currentQuantity": 10,
      "averageEntryPrice": 90,
      "currentPrice": 100
    }
  ],
  "totalRealizedPnl": 5000,
  "totalUnrealizedPnl": 6100,
  "netPnl": 11100
}
```

**Filtered Response** `200 OK` (`?symbols=BTC,ETH`):
```json
{
  "realizedPnl": [
    {
      "symbol": "BTC",
      "realizedPnl": 5000,
      "closedQuantity": 1
    }
  ],
  "unrealizedPnl": [
    {
      "symbol": "BTC",
      "unrealizedPnl": 5000,
      "currentQuantity": 1,
      "averageEntryPrice": 40000,
      "currentPrice": 45000
    },
    {
      "symbol": "ETH",
      "unrealizedPnl": 1000,
      "currentQuantity": 5,
      "averageEntryPrice": 2800,
      "currentPrice": 3000
    }
  ],
  "totalRealizedPnl": 5000,
  "totalUnrealizedPnl": 6000,
  "netPnl": 11000
}
```

### Market Data

#### Update Market Prices

**POST**

http://localhost:3000/portfolio/market-prices/bulk

Update market prices for multiple symbols atomically.

**Request**:
```json
{
  "prices": {
    "BTC": 45000,
    "ETH": 3000,
    "SOL": 100
  }
}
```

**Response** `200 OK`:
```json
{
  "message": "Market prices updated",
  "updatedSymbols": ["BTC", "ETH", "SOL"],
  "prices": {
    "BTC": 45000,
    "ETH": 3000,
    "SOL": 100
  }
}
```

**Tip**: Use `./init-prices.sh` to fetch live prices from CoinGecko API.

### Testing Utilities

#### Reset Portfolio

**POST**

http://localhost:3000/portfolio/reset

Clear all data (testing only).

**Response** `200 OK`:
```json
{
  "message": "Portfolio reset successfully"
}
```

## Testing

**Coverage**: 64 tests, 94% coverage, ~2s runtime

### Test Suite Overview

| Test Suite | Command | Purpose | What It Validates |
|------------|---------|---------|-------------------|
| **Unit Tests** | `npm test` | Fast isolated tests (Jest) | • FIFO matching logic<br/>• Edge cases (partial lots, decimals)<br/>• Input validation<br/>• Service layer correctness |
| **Functional Tests** | `./test-functional.sh` | API integration scenarios | • Basic FIFO accounting<br/>• Multi-symbol portfolios<br/>• Idempotency guarantees<br/>• Trade history retrieval |
| **Comprehensive Tests** | `./test-comprehensive.sh` | Complex financial scenarios | • Multi-lot FIFO with 3+ lots<br/>• Fractional quantities (0.5, 1.75)<br/>• Negative P&L (loss scenarios)<br/>• Position closeouts<br/>• Oversell validation<br/>• Aggregate P&L accuracy |
| **Load Tests** | `./test-load.sh` | Performance benchmarking | • Throughput (~189 req/s)<br/>• Latency (p50/p95/p99/p99.9)<br/>• 3-phase load (warmup/sustained/spike)<br/>• Cache optimization impact |

### Running Tests

```bash
# Quick validation
npm test                        # Unit tests (2s)

# Full test suite (recommended before submission)
./test-all.sh                   # Runs all test suites sequentially

# Individual test suites
npm test                        # Unit tests
./test-functional.sh            # API integration
./test-comprehensive.sh         # Financial correctness
./test-load.sh                  # Performance benchmarks

# Coverage report
npm run test:cov                # Generates coverage/lcov-report/index.html
```

**Master Test Runner** (`./test-all.sh`):
- Auto-starts server if not running
- Executes all 4 test suites in sequence
- Reports pass/fail summary
- Recommended for CI/CD pipelines

**Load Test Details**:
- **Warmup**: 5s @ 10 req/s (system warm-up)
- **Sustained**: 30s @ 150 req/s (50 writes + 100 reads)
- **Spike**: 5s @ 600 req/s (200 writes + 400 reads)
- **Metrics**: Per-endpoint latency percentiles, throughput, success rate

## Performance

**MVP Throughput**: 189 req/s sustained @ sub-10ms p99 latency (in-memory, single machine)

### Complexity & Latency

| Operation | Complexity | p99 Latency |
|-----------|------------|-------------|
| BUY Trade | O(1) | 0.3ms |
| SELL Trade | O(k) | 0.5ms |
| Get Positions | O(s) | 1.2ms |
| Get P&L | O(1) | <0.1ms |

*k = lots matched, s = symbols held*

### Load Test Results

**Environment**: MacBook M1/M2 (8-core, 16GB), Node.js v18+, 30s sustained load

| Endpoint | p50 | p95 | p99 |
|----------|-----|-----|-----|
| POST /trades | 1.71ms | 3.57ms | 7.19ms |
| GET /positions | 1.34ms | 3.15ms | 6.65ms |
| GET /pnl | 1.45ms | 3.55ms | 6.41ms |

**Cache**: P&L aggregates maintain O(1) performance (1.79ms avg) vs O(n) without caching.

## Quick Start

```bash
# 1. Install and start server
npm install
npm run start:dev  # http://localhost:3000

# 2. Initialize with live prices from CoinGecko
./init-prices.sh

# 3. Test the API
curl -X POST http://localhost:3000/portfolio/trades \
  -H "Content-Type: application/json" \
  -d '{
    "tradeId": "trade-001",
    "orderId": "order-001", 
    "symbol": "BTC",
    "side": "buy",
    "price": 40000,
    "quantity": 1,
    "executionTimestamp": "2024-01-15T10:00:00Z"
  }'

# Check portfolio
curl http://localhost:3000/portfolio/positions

# Get P&L breakdown
curl http://localhost:3000/portfolio/pnl
```

## Docker Deployment

**Multi-stage Production Build**: Dockerfile with builder stage (dependencies + compilation) + production stage (runtime only).

**Health Monitoring**: Built-in healthcheck probing `/health` endpoint every 10 seconds.

**Performance**: 192 req/s throughput with ~5ms added latency vs native (~3.19ms avg write, ~2.73ms avg read).

### Docker Commands

```bash
# Start container (detached mode)
docker-compose up -d

# Check container status
docker-compose ps

# View logs (last 50 lines, follow mode)
docker-compose logs --tail=50 -f

# Stop and remove container
docker-compose down

# Rebuild after code changes
docker-compose build --no-cache
docker-compose up -d
```

### Service Management

**Check if port 3000 is in use**:
```bash
# Check any process on port 3000
lsof -i :3000

# Check specifically for Docker container
docker ps | grep 3000
```

**Stop running services**:
```bash
# Kill local Node.js process
lsof -ti :3000 | xargs kill -9

# Stop Docker container
docker-compose down
```

### Running Tests Against Docker

All test scripts work with Docker without modification (both use `localhost:3000`):

```bash
# Start Docker container
docker-compose up -d && sleep 3

# Initialize prices
./init-prices.sh

# Run test suites (same commands as local)
./test-functional.sh
./test-comprehensive.sh
./test-load.sh
./test-all.sh

# Stop container when done
docker-compose down
```

## Production Considerations

**Current MVP**: 189 req/s sustained @ sub-10ms p99 latency (in-memory, single machine)

### Scaling Strategy

| Component | Technology | Purpose | Expected Throughput |
|-----------|------------|---------|--------------------|
| **Database** | TimescaleDB | Time-series trades/P&L with compression | 500-1000 req/s with connection pooling |
| **Cache** | Redis | Positions/P&L aggregates (TTL 5s) | 95%+ cache hit rate |
| **Event Streaming** | Redis Streams | Async FIFO processing, replay capability | Decouples writes from processing |
| **Rate Limiting** | Redis Sliding Window | 1000 req/min per user, 10k/min global | Protects from abuse |
| **API Servers** | Stateless Node.js | Horizontal scaling behind load balancer | 300-500 req/s per instance |
| **Sharding** | User-based | Hash `user_id` to 4 DB shards | 4x capacity, no cross-shard joins |

### Architecture Summary

**Event-Driven Flow**:

```mermaid
flowchart LR
    API[API POST /trades]
    Stream[Redis Stream<br/>trade-events]
    Workers[Consumer Workers<br/>FIFO processing]
    DB[TimescaleDB<br/>persistence]
    Cache[Redis Cache<br/>aggregates]
    
    API --> Stream
    Stream --> Workers
    Workers --> DB
    Workers --> Cache
```

**Design Choices**:
- Redis for caching, streaming, and rate limiting
- Idempotency via DB unique constraint on `trade_id`
- Circuit breaker for external price feeds
- Stateless API for horizontal scaling
- User-based sharding for linear capacity

**Target**: 10k req/s with 20-30 API servers + 4-shard DB cluster

**Monitoring**: Prometheus metrics for latency (p99), cache hit rate, circuit breaker state, connection pool usage

## Multi-User Architecture

### 1. Data Model Changes

Add `user_id` to all entities:
- **Trade**: `user_id` becomes partition key, `trade_id` unique per user (not global)
- **Position**: Composite key `(user_id, symbol)` - one position per user+symbol pair
- **Storage**: Nested maps `Map<user_id, Map<symbol, Position>>`

**Impact**: All lookups require `user_id` - current `positions.get("BTC")` becomes `positions.get(userId).get("BTC")`

### 2. Database Schema

**TimescaleDB changes**:
- Trades: Hypertable partitioned by `time` (automatic time-series optimization), composite PK `(user_id, trade_id, time)`
- Positions: Composite PK `(user_id, symbol)`, index on `user_id`
- Single DB instance sufficient for MVP (<100k users)

### 3. API Changes

**Pass `user_id` in request payload**:
- Add `user_id` field to all API requests (trades, positions, P&L queries)
- Service layer filters all operations by `user_id`
- Client responsible for providing correct `user_id`

### 4. Caching Strategy

**Cache only aggregated data** (not individual trades/FIFO queues):
- **Positions**: `user:{userId}:position:{symbol}` - Current holdings per symbol
- **P&L aggregates**: `user:{userId}:pnl` - Realized/unrealized totals
- **Prices**: `price:{symbol}` - Shared across all users
- TTL: 5s + jitter (0-2s) to prevent stampede, invalidate on user's writes

**Why not cache trades/queues**:
- Millions of trades = TB of Redis memory (expensive)
- FIFO queues change on every trade (high invalidation churn)
- Trades rarely re-read after creation (append-only audit log)
- Cache only hot read paths (positions, P&L), not cold storage (trades)

### 5. Event Streaming

**Partition by `user_id` to preserve trade order**:
- Create 4-8 streams: `trade-events:0`, `trade-events:1`, `trade-events:2`, `trade-events:3`
- Write: Hash `user_id` % 4 → determines stream (same user always → same stream)
- Read: Each consumer pinned to one stream (4 consumers for 4 streams)
- Guarantee: Same user_id → same stream → same consumer → ordering preserved

**Why not single stream**: Consumer groups distribute events round-robin → same user's trades to different workers → order lost

### 6. Horizontal Scaling (Optional - only if >100k users)

**Manual DB sharding by user_id** (application-level routing):
- Run 4 separate TimescaleDB instances
- Hash `user_id` % 4 → routes to DB instance (0=DB1, 1=DB2, 2=DB3, 3=DB4)
- All user data co-located on same instance (no cross-shard joins)
- Trade-off: Hot users may overload single instance
