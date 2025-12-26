#!/bin/bash

# Fetch current crypto prices from CoinGecko and update the tracker
# No API key needed

BASE_URL="http://localhost:3000"
COINGECKO_API="https://api.coingecko.com/api/v3/simple/price"

echo "Loading Fetching latest prices from CoinGecko..."

# get BTC, ETH, SOL, USDC
RESPONSE=$(curl -s "${COINGECKO_API}?ids=bitcoin,ethereum,solana,usd-coin&vs_currencies=usd")

if [ $? -ne 0 ]; then
  echo "[ERROR] Failed to fetch prices from CoinGecko"
  exit 1
fi

# parse prices (simple grep/sed, no jq needed)
BTC_PRICE=$(echo "$RESPONSE" | grep -o '"bitcoin"[^}]*"usd":[0-9.]*' | grep -o '[0-9.]*$')
ETH_PRICE=$(echo "$RESPONSE" | grep -o '"ethereum"[^}]*"usd":[0-9.]*' | grep -o '[0-9.]*$')
SOL_PRICE=$(echo "$RESPONSE" | grep -o '"solana"[^}]*"usd":[0-9.]*' | grep -o '[0-9.]*$')
USDC_PRICE=$(echo "$RESPONSE" | grep -o '"usd-coin"[^}]*"usd":[0-9.]*' | grep -o '[0-9.]*$')

# default for MATIC (now POL, not always available)
MATIC_PRICE="0.48"

# validate
if [ -z "$BTC_PRICE" ] || [ -z "$ETH_PRICE" ] || [ -z "$SOL_PRICE" ]; then
  echo "[ERROR] Failed to parse prices from response"
  echo "Response: $RESPONSE"
  exit 1
fi

echo "Prices: Current prices:"
echo "  BTC:   \$$BTC_PRICE"
echo "  ETH:   \$$ETH_PRICE"
echo "  SOL:   \$$SOL_PRICE"
echo "  MATIC: \$$MATIC_PRICE (default)"

# Send bulk update to API
echo ""
echo "📤 Updating prices in portfolio tracker..."

PAYLOAD=$(cat <<EOF
{
  "prices": {
    "BTC": $BTC_PRICE,
    "ETH": $ETH_PRICE,
    "SOL": $SOL_PRICE,
    "MATIC": $MATIC_PRICE
  }
}
EOF
)

RESPONSE=$(curl -s -X POST "${BASE_URL}/portfolio/market-prices/bulk" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if echo "$RESPONSE" | grep -q "Market prices updated"; then
  echo "[OK] Prices initialized successfully!"
else
  echo "[ERROR] Failed to update prices in server"
  exit 1
fi
