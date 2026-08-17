# ADR-003: ELK Stack for Log Aggregation

**Status:** Accepted

**Date:** 2026-05-30

**Author:** [Stanislav Hohulia](https://github.com/Hradivnyk)

## Context

The application uses Pino for structured JSON logging. In a Dockerised deployment logs are ephemeral — they exist only as long as the container is running and are not searchable without tooling. As the service grows, the ability to search, filter, and visualise logs becomes important for debugging and incident response.

Requirements:

- Collect logs from Docker containers automatically.
- Store logs persistently across container restarts.
- Provide a UI for searching and filtering.
- Fit within a single-node Docker Compose setup without significant resource overhead.

## Considered Options

### Log Aggregation Stack

#### 1. ELK Stack (Elasticsearch + Filebeat + Kibana)

**Pros:**

- Industry-standard tooling with extensive documentation.
- Kibana provides a powerful UI for full-text search, filtering, and visualisation.
- Filebeat integrates natively with Docker — reads container logs via Docker socket and attaches container metadata automatically.
- Elasticsearch handles structured JSON logs well; Pino's output can be ingested without transformation.

**Cons:**

- Elasticsearch requires a JVM and significant memory (~512 MB heap minimum).
- Three separate services to maintain.

---

#### 2. Grafana Loki + Promtail

A lightweight log aggregation system designed for Kubernetes but usable with Docker Compose.

**Pros:**

- Significantly lower resource usage than Elasticsearch — Loki indexes only labels, not full log content.
- Native integration with Grafana, which can also visualise metrics.

**Cons:**

- Full-text search is limited — only label-based filtering unless `--store-chunks-overlay` is configured.
- Less mature Docker Compose support compared to ELK.
- Grafana requires additional configuration to be useful.

---

#### 3. AWS CloudWatch Logs

Managed log aggregation service provided by AWS.

**Pros:**

- No infrastructure to maintain — fully managed.
- Native integration with EC2 and other AWS services.
- Log retention, alarms, and metric filters available out of the box.

**Cons:**

- Costs scale with ingestion volume — unpredictable for high-traffic scenarios.
- Requires AWS-specific configuration (`awslogs` Docker log driver) — ties the project to AWS.
- UI is functional but inferior to Kibana for ad-hoc log exploration.

---

#### 4. No aggregation — `docker logs` only

Relying solely on Docker's built-in logging.

**Pros:**

- Zero operational overhead.
- No additional services.

**Cons:**

- Logs are lost when a container is removed.
- No search or filtering beyond `grep`.
- Not viable for production incident response.

---

### Log Shipper: Filebeat vs Logstash

Both are part of the Elastic stack and can ship logs to Elasticsearch. The key difference is scope:

#### Filebeat

A lightweight Go-based agent (~50 MB RAM) that reads log files or Docker container logs and forwards them to Elasticsearch with minimal transformation.

**Pros:**

- Low resource footprint — does not compete with the application for memory.
- Zero-configuration JSON passthrough: since Pino already produces structured JSON, no parsing pipeline is needed.
- Native Docker autodiscovery via socket and container labels.

**Cons:**

- Limited transformation capabilities — not suitable if logs need to be parsed, enriched, or routed conditionally before indexing.

#### Logstash

A JVM-based data processing pipeline with a rich plugin ecosystem for parsing, filtering, and transforming log data.

**Pros:**

- Powerful transformation pipeline (grok, mutate, conditionals).
- Supports many input/output targets beyond Elasticsearch.

**Cons:**

- Requires ~512 MB JVM heap on top of Elasticsearch's own JVM — doubles the memory cost of the logging layer.
- Unnecessary complexity when the application already emits structured JSON.

---

### Kibana Access in Production

#### 1. Subdomain (`kibana.<DOMAIN>`)

Requires an additional DNS A record pointing to the same server.

**Cons:** Extra DNS configuration step; risk of forgetting to add the record during a new deployment.

#### 2. Path-based routing (`<DOMAIN>/kibana`)

Kibana served under a subpath of the existing domain via Caddy.

**Pros:** No additional DNS configuration — works with the same A record as the main application. Caddy handles auth and proxying in a single block.

**Cons:** Requires `SERVER_BASEPATH=/kibana` in Kibana's configuration so that its internal asset URLs are correct.

## Decision

**Log aggregation:** Use the **ELK stack** (Elasticsearch + Filebeat + Kibana).

ELK is chosen over Grafana Loki primarily for Kibana's full-text search — a meaningful advantage when investigating errors in JSON log payloads. CloudWatch is ruled out due to vendor lock-in and cost unpredictability. Plain `docker logs` is not viable for production.

**Log shipper:** Use **Filebeat** instead of Logstash.

The application emits structured JSON via Pino. Filebeat forwards these documents to Elasticsearch as-is, without any transformation. Adding Logstash would double the memory cost of the logging layer (~512 MB JVM) for no benefit in this setup.

**Kibana access:** Use **path-based routing** (`<DOMAIN>/kibana`) proxied through Caddy with `basic_auth`.

This avoids the need for an extra DNS record and keeps all external traffic entering through a single domain. Kibana's `SERVER_BASEPATH` is set to `/kibana` to ensure internal asset paths resolve correctly.

## Consequences

**Positive:**

- Persistent, searchable logs survive container restarts.
- Kibana provides full-text search across structured JSON log fields out of the box.
- Filebeat adds negligible memory overhead compared to Logstash.
- No extra DNS configuration required for Kibana access in production.

**Negative / trade-offs:**

- Elasticsearch requires a minimum of 512 MB heap (`ES_JAVA_OPTS=-Xms512m -Xmx512m`) — the most resource-heavy component in the stack. On a small EC2 instance (e.g. t3.micro with 1 GB RAM) this may cause memory pressure.
- `xpack.security.enabled=false` — Elasticsearch has no built-in authentication. Access is gated solely by Caddy's `basic_auth` in front of Kibana; direct access to Elasticsearch (port 9200) must be blocked at the firewall/Security Group level.
- If log parsing or conditional routing is needed in the future, Filebeat's transformation capabilities may be insufficient and a migration to Logstash or an Elasticsearch Ingest Pipeline will be required.
- Kibana is not available locally unless ports are exposed via `docker-compose.override.yml`.
