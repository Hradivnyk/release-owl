import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { JsonObject } from 'swagger-ui-express';

import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import logger from './platform/logger.js';
import { pinoHttp } from 'pino-http';
import { requestContext } from './utils/requestContext.js';
import { config } from './platform/config/index.js';
import subscriptionRoutes from './modules/subscriptions/subscription.routes.js';
import { errorHandler } from './platform/http/error-handler.js';
import { metricsMiddleware } from './platform/http/metricsMiddleware.js';
import { register } from './metrics/index.js';

const app = express();

app.use(express.static(resolve(process.cwd(), 'public')));

app.get('/health', (_req, res) => {
  res.sendStatus(200);
});

app.use(metricsMiddleware);

app.get('/metrics', (_req, res) => {
  res.set('Content-Type', register.contentType);
  register
    .metrics()
    .then((data) => res.send(data))
    .catch((err: unknown) => res.status(500).send(String(err)));
});

app.use(helmet());

app.use(
  cors({
    origin: config.app.allowedOrigin,
    methods: ['GET', 'POST'],
  }),
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // maximum 100 requests from the same IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true, // adds RateLimit-* headers
  legacyHeaders: false,
});

app.use(limiter);

// Establish requestId in AsyncLocalStorage before pinoHttp so service-layer
// logs automatically include the same ID without explicit propagation.
app.use((_req, _res, next) => {
  requestContext.run(randomUUID(), next);
});

app.use(
  pinoHttp({
    logger,
    genReqId: () => requestContext.getStore() ?? randomUUID(),
    customAttributeKeys: { reqId: 'requestId' },
  }),
);

app.use(express.json());

// Swagger UI needs 'unsafe-inline' for its own scripts and styles.
// Rather than removing CSP entirely, we apply a scoped helmet policy that
// relaxes only the directives Swagger UI requires while keeping all others.
const swaggerDocument = load(
  readFileSync(resolve(process.cwd(), 'swagger.yaml'), 'utf8'),
) as JsonObject;
app.use(
  '/api/docs',
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument),
);

app.use(express.urlencoded({ extended: false }));

app.use('/api', subscriptionRoutes);

app.use(errorHandler);

export default app;
