#!/usr/bin/env sh
# REST throughput benchmark using autocannon.
#
# Prerequisites:
#   - Node.js installed (npx autocannon is used — no global install needed)
#   - notification service running with EMAIL_SENDER=stub and REST_PORT=4000
#   - Port 4000 exposed to the host (docker-compose does this by default)
#
# Usage:
#   EMAIL_SENDER=stub docker compose up -d notification
#   sh bench/bench-rest.sh [url]

URL=${1:-http://localhost:4000/api/notify}

echo "=== REST benchmark against ${URL} ==="
npx autocannon \
  --method POST \
  --header "content-type: application/json" \
  --body '{
    "type": "notification",
    "email": "bench@example.com",
    "repo": "owner/repo",
    "tag_name": "v1.0.0",
    "unsubscribe_token": "bench-token"
  }' \
  --connections 50 \
  --amount 20000 \
  "${URL}"
