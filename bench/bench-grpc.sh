#!/usr/bin/env sh
# gRPC throughput benchmark using ghz.
#
# Prerequisites:
#   - ghz binary installed: https://ghz.sh/ (brew install ghz / go install ...)
#   - notification service running with EMAIL_SENDER=stub and GRPC_PORT=50051
#   - Port 50051 exposed to the host (docker-compose does this by default)
#
# Usage:
#   EMAIL_SENDER=stub docker compose up -d notification
#   sh bench/bench-grpc.sh [host:port]
#
# The proto file path is relative to the repo root; run this script from there.

HOST=${1:-localhost:50051}
PROTO="packages/proto/proto/releaseowl/notification/v1/notification.proto"

echo "=== gRPC benchmark against ${HOST} ==="
ghz \
  --insecure \
  --proto "${PROTO}" \
  --call "releaseowl.notification.v1.NotificationService/Notify" \
  --data '{
    "notification": {
      "email": "bench@example.com",
      "repo": "owner/repo",
      "tagName": "v1.0.0",
      "unsubscribeToken": "bench-token"
    }
  }' \
  --concurrency 50 \
  --total 20000 \
  --format summary \
  "${HOST}"
