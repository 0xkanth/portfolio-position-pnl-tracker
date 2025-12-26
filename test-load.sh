#!/bin/bash

# Load test runner - measures performance under realistic load

echo "Starting load test"
echo ""

# check server
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "[FAIL] Server not running on port 3000"
    echo "Start it first: npm run start:dev"
    echo ""
    exit 1
fi

echo "[OK] Server detected"
echo ""

# run test
node load-test.js

echo ""
echo "[OK] Load test complete!"
