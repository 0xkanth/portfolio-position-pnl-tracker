#!/bin/bash

API_URL="http://localhost:3000"

echo ""
echo "COMPREHENSIVE FINANCIAL CORRECTNESS TEST - FIFO"
echo "================================================"
echo ""

echo "Resetting portfolio to clean state..."
curl -s -X POST "$API_URL/portfolio/reset" > /dev/null
echo "Portfolio reset complete"
echo ""

echo "Initializing market prices..."
./init-prices.sh
echo ""

echo "="
echo "TEST 1: Complex FIFO with Multiple Lots and Partial Sells"
echo "="
echo ""
echo "Scenario: Buy 3 lots at different prices, sell in parts"
echo ""

# Buy Lot 1: 2 BTC @ $30,000 (Cost: $60,000)
echo "1. Buy 2 BTC @ \$30,000"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-001","orderId":"order-c1","symbol":"BTC","side":"buy","price":30000,"quantity":2,"executionTimestamp":"2024-01-15T10:00:00Z"}' > /dev/null

# Buy Lot 2: 3 BTC @ $35,000 (Cost: $105,000)
echo "2. Buy 3 BTC @ \$35,000"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-002","orderId":"order-c2","symbol":"BTC","side":"buy","price":35000,"quantity":3,"executionTimestamp":"2024-01-15T10:05:00Z"}' > /dev/null

# Buy Lot 3: 1 BTC @ $40,000 (Cost: $40,000)
echo "3. Buy 1 BTC @ \$40,000"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-003","orderId":"order-c3","symbol":"BTC","side":"buy","price":40000,"quantity":1,"executionTimestamp":"2024-01-15T10:10:00Z"}' > /dev/null

echo ""
echo "Portfolio after 3 buys:"
PORTFOLIO=$(curl -s "$API_URL/portfolio/positions")
echo "$PORTFOLIO" | jq -r '.positions[] | "   \(.symbol): \(.totalQuantity) BTC @ avg \(.averageEntryPrice)"'
TOTAL_QTY=$(echo "$PORTFOLIO" | jq -r '.positions[0].totalQuantity')
AVG_PRICE=$(echo "$PORTFOLIO" | jq -r '.positions[0].averageEntryPrice')

# Verify: Total = 6 BTC, Avg = (60k + 105k + 40k) / 6 = 205k / 6 = 34,166.67
echo ""
echo "CHECK: Verification:"
echo "  Total Cost = \$60,000 + \$105,000 + \$40,000 = \$205,000"
echo "  Total Qty = 2 + 3 + 1 = 6 BTC"
echo "  Expected Avg = \$205,000 / 6 = \$34,166.67"
echo "  Actual Avg = \$$AVG_PRICE"

if [ "$TOTAL_QTY" == "6" ]; then
    echo "  [PASS] Quantity CORRECT"
else
    echo "  [FAIL] Quantity WRONG: Expected 6, Got $TOTAL_QTY"
fi

echo ""
echo "="
echo "Sell 4 BTC @ \$45,000 (Should consume Lot 1 entirely + 2 from Lot 2)"
echo "="
echo ""

# Sell 4 BTC @ $45,000
# FIFO: Should sell 2 BTC from Lot 1 @ 30k, then 2 BTC from Lot 2 @ 35k
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-004","orderId":"order-c4","symbol":"BTC","side":"sell","price":45000,"quantity":4,"executionTimestamp":"2024-01-15T11:00:00Z"}' > /dev/null

echo "PnL after selling 4 BTC @ \$45,000:"
PNL=$(curl -s "$API_URL/portfolio/pnl")
REALIZED=$(echo "$PNL" | jq -r '.realizedPnl[0].realizedPnl')
CLOSED_QTY=$(echo "$PNL" | jq -r '.realizedPnl[0].closedQuantity')

echo ""
echo "CHECK: FIFO Calculation:"
echo "  Lot 1: Sell 2 BTC bought @ \$30k, sold @ \$45k"
echo "         PnL = (45,000 - 30,000) × 2 = \$30,000"
echo "  Lot 2: Sell 2 BTC bought @ \$35k, sold @ \$45k"
echo "         PnL = (45,000 - 35,000) × 2 = \$20,000"
echo "  Total Realized PnL = \$30,000 + \$20,000 = \$50,000"
echo "  Actual Realized PnL = \$$REALIZED"

if [ "$REALIZED" == "50000" ]; then
    echo "  [PASS] Realized PnL CORRECT"
else
    echo "  [FAIL] Realized PnL WRONG: Expected \$50,000, Got \$$REALIZED"
fi

PORTFOLIO=$(curl -s "$API_URL/portfolio/positions")
REMAINING_QTY=$(echo "$PORTFOLIO" | jq -r '.positions[0].totalQuantity')
REMAINING_AVG=$(echo "$PORTFOLIO" | jq -r '.positions[0].averageEntryPrice')

echo ""
echo "CHECK: Remaining Position:"
echo "  Lot 2: 1 BTC @ \$35,000 (from original 3, sold 2)"
echo "  Lot 3: 1 BTC @ \$40,000 (untouched)"
echo "  Expected: 2 BTC @ avg \$37,500"
echo "  Actual: $REMAINING_QTY BTC @ avg \$$REMAINING_AVG"

if [ "$REMAINING_QTY" == "2" ] && [ "$REMAINING_AVG" == "37500" ]; then
    echo "  [PASS] Remaining Position CORRECT"
else
    echo "  [FAIL] Remaining Position WRONG"
fi

echo ""
echo "="
echo "TEST 2: Fractional Trading (Decimal Precision)"
echo "="
echo ""

# Buy 0.5 ETH @ $2,000
echo "1. Buy 0.5 ETH @ \$2,000"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-005","orderId":"order-c5","symbol":"ETH","side":"buy","price":2000,"quantity":0.5,"executionTimestamp":"2024-01-15T12:00:00Z"}' > /dev/null

# Buy 1.75 ETH @ $2,400
echo "2. Buy 1.75 ETH @ \$2,400"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-006","orderId":"order-c6","symbol":"ETH","side":"buy","price":2400,"quantity":1.75,"executionTimestamp":"2024-01-15T12:05:00Z"}' > /dev/null

# Sell 0.8 ETH @ $2,600
echo "3. Sell 0.8 ETH @ \$2,600"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-007","orderId":"order-c7","symbol":"ETH","side":"sell","price":2600,"quantity":0.8,"executionTimestamp":"2024-01-15T12:30:00Z"}' > /dev/null

PNL=$(curl -s "$API_URL/portfolio/pnl")
ETH_REALIZED=$(echo "$PNL" | jq -r '.realizedPnl[] | select(.symbol=="ETH") | .realizedPnl')

echo ""
echo "CHECK: Fractional FIFO Calculation:"
echo "  Sell 0.5 ETH from Lot 1 @ \$2,000:"
echo "    PnL = (2,600 - 2,000) × 0.5 = \$300"
echo "  Sell 0.3 ETH from Lot 2 @ \$2,400:"
echo "    PnL = (2,600 - 2,400) × 0.3 = \$60"
echo "  Total = \$360"
echo "  Actual = \$$ETH_REALIZED"

if [ "$ETH_REALIZED" == "360" ]; then
    echo "  [PASS] Fractional PnL CORRECT"
else
    echo "  [FAIL] Fractional PnL WRONG: Expected \$360, Got \$$ETH_REALIZED"
fi

echo ""
echo "="
echo "TEST 3: Loss Scenarios (Negative PnL)"
echo "="
echo ""

# Buy high, sell low
echo "1. Buy 10 SOL @ \$150"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-008","orderId":"order-c8","symbol":"SOL","side":"buy","price":150,"quantity":10,"executionTimestamp":"2024-01-15T13:00:00Z"}' > /dev/null

echo "2. Sell 5 SOL @ \$120 (LOSS)"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-009","orderId":"order-c9","symbol":"SOL","side":"sell","price":120,"quantity":5,"executionTimestamp":"2024-01-15T13:05:00Z"}' > /dev/null

PNL=$(curl -s "$API_URL/portfolio/pnl")
SOL_REALIZED=$(echo "$PNL" | jq -r '.realizedPnl[] | select(.symbol=="SOL") | .realizedPnl')

echo ""
echo "CHECK: Loss Calculation:"
echo "  Sell 5 SOL bought @ \$150, sold @ \$120"
echo "  PnL = (120 - 150) x 5 = -\$150"
echo "  Actual = \$$SOL_REALIZED"

if [ "$SOL_REALIZED" == "-150" ]; then
    echo "  [PASS] Loss Calculation CORRECT"
else
    echo "  [FAIL] Loss Calculation WRONG: Expected -\$150, Got \$$SOL_REALIZED"
fi

echo ""
echo "="
echo "TEST 4: Multiple Symbols with Interleaved Trades"
echo "="
echo ""

# Complex multi-symbol scenario
echo "1. Buy 100 MATIC @ \$0.50"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-010","orderId":"order-c10","symbol":"MATIC","side":"buy","price":0.50,"quantity":100,"executionTimestamp":"2024-01-15T14:00:00Z"}' > /dev/null

echo "2. Buy 200 MATIC @ \$0.60"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-011","orderId":"order-c11","symbol":"MATIC","side":"buy","price":0.60,"quantity":200,"executionTimestamp":"2024-01-15T14:05:00Z"}' > /dev/null

echo "3. Sell 150 MATIC @ \$0.70"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-012","orderId":"order-c12","symbol":"MATIC","side":"sell","price":0.70,"quantity":150,"executionTimestamp":"2024-01-15T14:10:00Z"}' > /dev/null

PNL=$(curl -s "$API_URL/portfolio/pnl")
MATIC_REALIZED=$(echo "$PNL" | jq -r '.realizedPnl[] | select(.symbol=="MATIC") | .realizedPnl')

echo ""
echo "CHECK: Multi-Symbol FIFO:"
echo "  Sell 100 MATIC from Lot 1 @ \$0.50:"
echo "    PnL = (0.70 - 0.50) × 100 = \$20"
echo "  Sell 50 MATIC from Lot 2 @ \$0.60:"
echo "    PnL = (0.70 - 0.60) × 50 = \$5"
echo "  Total = \$25"
echo "  Actual = \$$MATIC_REALIZED"

if [ "$MATIC_REALIZED" == "25" ]; then
    echo "  [PASS] Multi-Symbol FIFO CORRECT"
else
    echo "  [FAIL] Multi-Symbol FIFO WRONG: Expected \$25, Got \$$MATIC_REALIZED"
fi

echo ""
echo "="
echo "TEST 5: Complete Position Close Out"
echo "="
echo ""

# Sell remaining SOL completely
PORTFOLIO=$(curl -s "$API_URL/portfolio/positions")
REMAINING_SOL=$(echo "$PORTFOLIO" | jq -r '.positions[] | select(.symbol=="SOL") | .totalQuantity')

echo "1. Selling remaining $REMAINING_SOL SOL @ \$130 (close position)"
curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d "{\"symbol\":\"SOL\",\"side\":\"sell\",\"price\":130,\"quantity\":$REMAINING_SOL}" > /dev/null

PORTFOLIO=$(curl -s "$API_URL/portfolio/positions")
HAS_SOL=$(echo "$PORTFOLIO" | jq -r '.positions[] | select(.symbol=="SOL") | .symbol' | wc -l | tr -d ' ')

echo ""
echo "Position Closure:"
echo "  After selling all SOL, position should not appear in portfolio"
if [ "$HAS_SOL" == "0" ]; then
    echo "  [PASS] Position Closed CORRECTLY"
else
    echo "  [FAIL] Position Still Exists (should be removed)"
fi

echo ""
echo "="
echo "TEST 6: Aggregate PnL Across All Symbols"
echo "="
echo ""

PNL=$(curl -s "$API_URL/portfolio/pnl")
echo "$PNL" | jq '.'

TOTAL_REALIZED=$(echo "$PNL" | jq -r '.totalRealizedPnl')
TOTAL_UNREALIZED=$(echo "$PNL" | jq -r '.totalUnrealizedPnl')
NET_PNL=$(echo "$PNL" | jq -r '.netPnl')

echo ""
echo "CHECK: Final Aggregate PnL:"
echo "  Total Realized PnL: \$$TOTAL_REALIZED"
echo "  Total Unrealized PnL: \$$TOTAL_UNREALIZED"
echo "  Net PnL: \$$NET_PNL"
echo ""

# Verify math
EXPECTED_NET=$(echo "$TOTAL_REALIZED + $TOTAL_UNREALIZED" | bc)
if [ "$NET_PNL" == "$EXPECTED_NET" ]; then
    echo "  [PASS] Net PnL = Realized + Unrealized (CORRECT)"
else
    echo "  [FAIL] Net PnL Math WRONG"
fi

echo ""
echo "="
echo "TEST 7: Edge Case - Insufficient Balance Error Handling"
echo "="
echo ""

echo "Attempting to sell more BTC than available..."
RESPONSE=$(curl -s -X POST "$API_URL/portfolio/trades" -H "Content-Type: application/json" \
  -d '{"tradeId":"comp-013","orderId":"order-c13","symbol":"BTC","side":"sell","price":50000,"quantity":100,"executionTimestamp":"2024-01-15T15:00:00Z"}')

ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message')
if [[ "$ERROR_MSG" == *"Insufficient"* ]]; then
    echo "[PASS] Properly rejected over-sell with error: $ERROR_MSG"
else
    echo "[FAIL] Should have rejected over-sell"
fi

echo ""
echo "="
echo "FINAL SUMMARY"
echo "="
echo ""

echo "All Positions:"
curl -s "$API_URL/portfolio/positions" | jq '.positions[] | "  \(.symbol): \(.totalQuantity) @ avg $\(.averageEntryPrice) | Unrealized: $\(.unrealizedPnl)"'

echo ""
echo "Complete PnL Breakdown:"
curl -s "$API_URL/portfolio/pnl" | jq -r '"  Realized: $\(.totalRealizedPnl)\n  Unrealized: $\(.totalUnrealizedPnl)\n  Net PnL: $\(.netPnl)"'

echo ""
echo "ALL TESTS COMPLETED"
echo ""
echo "Financial calculations validated across:"
echo "  - Complex multi-lot FIFO scenarios"
echo "  - Fractional/decimal trading"
echo "  - Loss scenarios (negative PnL)"
echo "  - Multiple symbols with interleaved trades"
echo "  - Complete position closeouts"
echo "  - Aggregate PnL calculations"
echo "  - Error handling for invalid operations"
echo ""
