#!/bin/sh
set -e

ES_URL="http://elasticsearch:9200"
KIBANA_URL="http://kibana:5601/kibana"
TEMPLATE_NAME="app-logs"
TEMPLATE_FILE="/etc/elasticsearch/index-template.json"
SAVED_OBJECTS_FILE="/etc/kibana/saved_objects.ndjson"

echo "Waiting for Elasticsearch to be available..."
until curl -sf "${ES_URL}/_cluster/health" | grep -qE '"status":"(green|yellow)"'; do
  echo "  Elasticsearch not ready, retrying in 5s..."
  sleep 5
done
echo "Elasticsearch is available."

echo "Applying Elasticsearch index template '${TEMPLATE_NAME}'..."

curl -sf -X PUT "${ES_URL}/_index_template/${TEMPLATE_NAME}" \
  -H 'Content-Type: application/json' \
  -d @"${TEMPLATE_FILE}"

echo ""
echo "Index template '${TEMPLATE_NAME}' applied."

echo "Waiting for Kibana to be available..."
until curl -sf "${KIBANA_URL}/api/status" | grep -q '"level":"available"'; do
  echo "  Kibana not ready, retrying in 5s..."
  sleep 5
done
echo "Kibana is available."

echo "Importing Kibana saved objects..."

import_response=$(curl -s -X POST "${KIBANA_URL}/api/saved_objects/_import?overwrite=true" \
  -H "kbn-xsrf: true" \
  -F "file=@${SAVED_OBJECTS_FILE}")

echo ""
echo "Import response: ${import_response}"

if ! echo "${import_response}" | grep -q '"success":true'; then
  echo "ERROR: Kibana saved objects import failed!" >&2
  exit 1
fi

echo "Kibana saved objects imported."
