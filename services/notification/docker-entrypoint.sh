#!/bin/sh
set -e

echo "Running notification service migrations..."
node services/notification/dist/migrate.js

echo "Starting notification service..."
exec node services/notification/dist/index.js
