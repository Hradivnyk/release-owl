# Observability

## Logging

Structured JSON logging via **Pino** + `pino-http` for HTTP requests. Aggregated through the **ELK stack**.

| Level   | When                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------- |
| `DEBUG` | Verbose internals (disabled in production)                                                          |
| `INFO`  | Successful operations: subscription created, email sent, scan completed, saga completed/compensated |
| `ERROR` | Failures: GitHub API errors, SMTP errors, saga compensation triggered                               |

**Pipeline:**

```text
Node.js (Pino JSON) → Docker log driver → Filebeat → Elasticsearch → Kibana
```

Filebeat reads container logs via Docker socket using `co.elastic.logs/*` labels on `app` and `notification`. In production Kibana is at `https://<DOMAIN>/kibana` (Caddy `basic_auth`).

`es-init` one-shot container applies the composable index template (`elasticsearch/index-template.json`) on every `docker compose up`, mapping unmapped string fields to `keyword` by default.

---

## Metrics

Exposed at `GET /metrics` (Prometheus format via `prom-client`). Blocked externally by Caddy — only Prometheus scrapes it every 15 s.

**Pipeline:**

```text
Node.js (prom-client) → GET /metrics → Prometheus → Grafana
```

Grafana at `https://<DOMAIN>/grafana`. Dashboard auto-provisioned from `grafana/dashboards/github-scanner.json`.

| Metric                            | Type      | Labels                     | Description                            |
| --------------------------------- | --------- | -------------------------- | -------------------------------------- |
| `http_requests_total`             | Counter   | method, route, status_code | Total HTTP requests                    |
| `http_request_duration_seconds`   | Histogram | method, route, status_code | Latency P50/P95/P99                    |
| `github_api_requests_total`       | Counter   | operation, result          | GitHub API calls                       |
| `subscription_operations_total`   | Counter   | operation, result          | Subscribe/confirm/unsubscribe outcomes |
| `scanner_releases_detected_total` | Counter   | repo                       | New releases found                     |
| `scanner_emails_sent_total`       | Counter   | repo                       | Notification emails sent               |
| `scanner_scan_duration_seconds`   | Histogram | result                     | Full scan cycle duration               |

Default Node.js runtime metrics (CPU, heap, event-loop lag) collected via `collectDefaultMetrics()`.

---

## Alerting (planned)

| Alert             | Condition                                        |
| ----------------- | ------------------------------------------------ |
| Service down      | No successful HTTP responses for > 2 min         |
| Scanner stalled   | No scan cycle completed within 2× cron interval  |
| GitHub rate limit | `github_api_errors_total{type="rate_limit"}` > 0 |
| High error rate   | HTTP 5xx rate > 1% over 5 min                    |
