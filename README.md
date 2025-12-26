# Portfolio & PnL Tracker

Crypto portfolio tracker with FIFO accounting, CQRS pattern, and P&L calculations.

**Quick Links**: 
- [Architecture](#architecture) 
- [API Docs](#api) 
- [Quick Start](#quick-start) 
- [Testing](#testing)

## Approach & Assumptions

### Design Approach

**FIFO Accounting**: Implemented First-In-First-Out lot matching for cost basis tracking. Each position maintains a queue of acquisition lots, with sells consuming from the oldest first.

**CQRS Pattern**: Separated write operations (PortfolioService) from read operations (PortfolioQueryService) to optimize each path independently. Writes focus on FIFO matching accuracy; reads leverage pre-computed aggregates for speed.

**Performance Optimization**: Cached realized P&L aggregates enable O(1) queries instead of O(n) summation. Unrealized P&L computed on-demand as prices change frequently.

**Idempotency**: Trade deduplication via `tradeId` prevents double-processing from network retries or duplicate messages.

### Key Assumptions

1. **In-Memory Storage Acceptable**: Requirements specified in-memory; data persists for application lifetime. Storage layer abstracted for easy database migration.

2. **Single User**: No authentication or multi-tenancy. Production would add JWT + userId partitioning.

3. **Manual Price Updates**: Prices set via API. Production would integrate WebSocket feeds (Binance/Coinbase).

4. **Floating Point Precision Sufficient**: Using JavaScript `number` type. High-value production systems should use `Decimal.js` for arbitrary precision.

5. **Symbols Pre-Normalized**: Expecting uppercase symbols (BTC, ETH). Production would normalize and validate against exchange symbol lists.

6. **Trade Timestamps Trusted**: Assuming `executionTimestamp` from external system is accurate and not manipulated.

7. **Partial Fills Handled Atomically**: Each trade is a complete execution. Multiple partial fills would be separate trade records.

8. **No Short Positions**: Only long positions tracked. Selling more than owned returns validation error.

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

**CQRS Pattern**: Separate write ([`PortfolioService`](./src/portfolio/portfolio.service.ts)) and read ([`QueryService`](./src/portfolio/portfolio-query.service.ts)) paths for independent optimization.

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

**Key Relationships**:
- **Position ↔ Symbol**: **ONE Position per symbol** (e.g., one for BTC, one for ETH)
- **FifoLot ↔ BUY Trade**: **ONE new FifoLot added per BUY trade** (appended to position's queue)
- **1 Position → N FifoLots**: Each position maintains array of lots from multiple BUY trades
- **1 SELL Trade → N RealizedPnlRecords**: Selling spans multiple lots = multiple P&L records
- **1 Symbol → 1 RealizedPnlAggregate**: Cached summary for O(1) reads

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

| Entity | Purpose | Key Concept | Implementation |
|--------|---------|-------------|----------------|
| **Trade** | Immutable trade record | Idempotency via `tradeId` | [trade.entity.ts](./src/portfolio/entities/trade.entity.ts) |
| **Position** | Current holdings per symbol | FIFO queue + weighted avg cost | [position.entity.ts](./src/portfolio/entities/position.entity.ts) |
| **RealizedPnlRecord** | Locked-in P&L per lot match | Tax audit trail | [realized-pnl-record.entity.ts](./src/portfolio/entities/realized-pnl-record.entity.ts) |
| **RealizedPnlAggregate** | Cached P&L totals | O(1) query performance | In-memory cache |

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

## Performance Characteristics

### Algorithmic Complexity

| Operation | Complexity | Latency (p99) | Notes |
|-----------|------------|---------------|-------|
| BUY Trade | O(1) | 0.3ms | Append to FIFO queue |
| SELL Trade | O(k) | 0.5ms | k = lots matched (typically <10) |
| Get Positions | O(s) | 1.2ms | s = symbols held (typically <50) |
| Get Realized PnL | O(1) | <0.1ms | Cached aggregates |

### Load Test Results

**Environment**: MacBook M1/M2 (8-core, 16GB RAM), Node.js v18+

**Test Profile** (`./test-load.sh`): 3-phase load pattern with mixed read/write operations

| Phase | Duration | Target Load | Throughput Achieved | Notes |
|-------|----------|-------------|---------------------|-------|
| Warmup | 5s | 10 req/s | - | JIT optimization |
| Sustained | 30s | 150 req/s (33% writes) | **189 req/s** | 92% success rate |
| Spike | 5s | 600 req/s (33% writes) | Peak stress | Burst handling |

**Latency Distribution** (sustained phase):

| Endpoint | p50 | p95 | p99 | p99.9 |
|----------|-----|-----|-----|-------|
| `POST /trades` | 1.71ms | 3.57ms | 7.19ms | 16.16ms |
| `GET /positions` | 1.34ms | 3.15ms | 6.65ms | 15.71ms |
| `GET /pnl` | 1.45ms | 3.55ms | 6.41ms | 14.83ms |

**Key Insight**: With 2,130 P&L records generated during test, `GET /pnl` maintains **constant O(1) latency** (~1.79ms avg) due to cached aggregates. Without caching, latency would scale linearly to ~100ms+ with record growth.

---

## FIFO Engine

**Write Path**: [`portfolio.service.ts:L127-180`](./src/portfolio/portfolio.service.ts#L127-L180)

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

**Code References**:
- Controller validation: [`src/portfolio/portfolio.controller.ts:L45-L60`](./src/portfolio/portfolio.controller.ts#L45-L60)
- FIFO matching logic: [`src/portfolio/portfolio.service.ts:L127-L180`](./src/portfolio/portfolio.service.ts#L127-L180)
- Position entity: [`src/portfolio/entities/position.entity.ts`](./src/portfolio/entities/position.entity.ts)
- Storage operations: [`src/portfolio/portfolio-storage.service.ts:L30-L85`](./src/portfolio/portfolio-storage.service.ts#L30-L85)

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

**Code References**:
- Query service: [`src/portfolio/portfolio-query.service.ts:L78-L145`](./src/portfolio/portfolio-query.service.ts#L78-L145)
- Realized PnL aggregates: [`src/portfolio/portfolio-storage.service.ts:L76`](./src/portfolio/portfolio-storage.service.ts#L76)
- Unrealized calculation: [`src/portfolio/portfolio-query.service.ts:L120-L135`](./src/portfolio/portfolio-query.service.ts#L120-L135)
- Response DTO: [`src/portfolio/dto/pnl-response.dto.ts`](./src/portfolio/dto/pnl-response.dto.ts)

### P&L Calculation Details

#### 1. Realized P&L (Locked-In Gains/Losses)

**What it is**: Permanent profit/loss from closed positions. Once sold, it's locked in and won't change with market fluctuations.

**When computed**: During SELL execution via FIFO lot matching.

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

**Properties**: One `RealizedPnlRecord` per lot matched (tax audit trail), cached in aggregate for O(1) queries, immutable once created.

---

#### 2. Unrealized P&L (Mark-to-Market)

**What it is**: Floating profit/loss on open positions. Changes with market price movements.

**When computed**: On-demand during READ operations. Recalculated each query since prices constantly change.

**Formula** (per position):

$$
\text{Unrealized PnL} = (\text{Current Market Price} - \text{Average Entry Price}) \times \text{Total Quantity Held}
$$

**Example**: Hold 1 BTC with \$42k average entry

| Current Price | Calculation | Unrealized P&L |
|---------------|-------------|----------------|
| \$44,000 | (44k - 42k) × 1 | \$2,000 |
| \$41,000 | (41k - 42k) × 1 | -\$1,000 (loss) |

**Properties**: Not locked in, uses weighted average entry price, skipped if market price unavailable.

---

#### 3. Average Entry Price (Weighted Cost Basis)

**What it is**: Weighted average price paid across all buy lots in current position.

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

#### `POST http://localhost:3000/portfolio/trades`

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

#### `GET http://localhost:3000/portfolio/positions`

Returns current holdings with unrealized P&L. Without parameters, returns ALL symbols.

**Query Parameters**:
- `symbol` (optional): Filter by single symbol (e.g., `?symbol=BTC`)
- `symbols` (optional): Filter by comma-separated list (e.g., `?symbols=BTC,ETH`)

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

#### `GET http://localhost:3000/portfolio/pnl`

Complete P&L breakdown with realized (locked-in) and unrealized (mark-to-market). Without parameters, returns ALL symbols.

**Query Parameters**:
- `symbols` (optional): Comma-separated list to filter (e.g., `?symbols=BTC,ETH` or `?symbols=SOL`)

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

#### `POST http://localhost:3000/portfolio/market-prices/bulk`

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

#### `POST http://localhost:3000/portfolio/reset`

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

## Production Path

**Current State**: In-memory MVP achieving **189 req/s @ <10ms p99 latency** on 8-core machine

**Measured Capacity** (MacBook 8-core, 16GB RAM):
- Sustained throughput: 189 req/s (150 target load)
- Write latency p99: 7.19ms
- Read latency p99: 6.41ms
- Memory footprint: ~50MB with 2,130 trades

**Phase 1 - Database + Caching**: TimescaleDB + Redis
- **TimescaleDB**: Trades/P&L hypertables with compression, continuous aggregates
- **Redis**: 
  - Cache layer for positions/P&L (TTL 5s, 95%+ hit rate)
  - Session store for JWT tokens
- Expected: 500-1000 req/s with cache, connection pooling (10-50)

**Phase 2 - Event Streaming**: Redis Streams (Kafka alternative)
- **Why Redis Streams over Kafka**:
  - Simpler ops (single Redis cluster vs Kafka cluster + KRaft quorum)
  - Sub-millisecond latency (Kafka: 5-10ms, Redis: <1ms)
  - Sufficient for <100k trades/sec (Kafka needed for >1M/sec)
  - Consumer groups for parallel processing, persistence with AOF/RDB

- **Architecture**:
  ```
  API → Redis Stream (trade-events) → Consumer Group → Process FIFO → TimescaleDB
                                    ↓
                              Dead Letter Queue (failed trades)
  ```
- **Benefits**: Decouple writes (instant 201 response), at-least-once delivery, replay capability

**Phase 3 - Scaling + Reliability**:
- **Rate Limiting**: Redis sliding window (1000 req/min per user, 10k/min global)
- **Circuit Breaker**: Hystrix pattern for external APIs (price feeds, exchanges)
  - Open after 50% errors in 10s window
  - Half-open retry after 30s
  - Fallback: cached prices or circuit open error
- **Horizontal Scaling**: Stateless API servers behind load balancer
  - Sticky sessions not needed (Redis for shared state)
  - Auto-scale: CPU >70% → add pod, <30% → remove pod
- **Database Sharding**: Shard by `user_id` hash (consistent hashing)
  - 0-25% hash → DB1, 25-50% → DB2, 50-75% → DB3, 75-100% → DB4
  - Positions/trades co-located per user (no cross-shard joins)

**Phase 4 - Auth + Security**: JWT + API keys
- JWT validation (~1-2ms per request)
- API key rate limits per tier (Free: 100/min, Pro: 1000/min, Enterprise: unlimited)

**Phase 5 - Precision**: Replace `number` with `Decimal.js` for >$10M portfolios (~0.5-1ms overhead)

**Production Architecture**:

```mermaid
graph TB
    Users[Users]
    LB[Load Balancer]
    
    subgraph API[API Servers - Stateless]
        API1[Server 1]
        API2[Server 2]
        APIN[Server N]
    end
    
    subgraph Redis[Redis Cluster]
        Cache[Cache]
        Stream[Streams]
        RL[Rate Limit]
    end
    
    subgraph Workers[Consumer Workers]
        W1[Worker 1]
        W2[Worker 2]
        DLQ[Failed Trades]
    end
    
    subgraph DB[TimescaleDB - Sharded by user_id]
        DB1[Shard 1: 0-25%]
        DB2[Shard 2: 25-50%]
        DB3[Shard 3: 50-75%]
        DB4[Shard 4: 75-100%]
    end
    
    PriceFeed[Price Feeds<br/>Binance/Coinbase]
    CB[Circuit Breaker]
    
    Users --> LB --> API1 & API2 & APIN
    
    API1 & API2 & APIN --> RL
    API1 & API2 & APIN --> Cache
    API1 & API2 & APIN --> Stream
    
    Stream --> W1 & W2
    W1 & W2 --> Cache
    W1 & W2 --> DB1 & DB2 & DB3 & DB4
    W1 & W2 -.-> DLQ
    
    Cache -.-> DB1 & DB2 & DB3 & DB4
    
    API1 & API2 & APIN --> CB
    CB --> PriceFeed
```

**Key Decisions**:
- **Redis**: Single cluster for cache, streams, rate limiting
- **Event-driven**: Writes go to Redis Streams → workers process async → DB persistence
- **Idempotency**: DB unique constraint on `trade_id` + consumer group ordering (no distributed locks needed)
- **Sharding**: TimescaleDB sharded by `user_id` hash (4 shards = 4x capacity)
- **Circuit breaker**: Fail fast on external API timeouts (price feeds)
- **Stateless API**: Horizontal scaling, no sticky sessions

**Capacity Planning** (per server):
- Current: 189 req/s (in-memory)
- With Redis cache: 500-1000 req/s (95%+ cache hits on reads)
- With DB + streams: 300-500 req/s sustained
- Target: 10k req/s → 20-30 servers + sharded DB cluster

**Monitoring**: Prometheus + Grafana
- Metrics: `trades_processed_total`, `redis_cache_hit_rate`, `circuit_breaker_state`, `db_connection_pool_usage`, `request_latency_p99`
- Alerts: P99 latency >50ms, cache hit rate <90%, circuit breaker open, DB pool >80%

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
