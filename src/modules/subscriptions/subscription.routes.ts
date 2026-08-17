import { Router } from 'express';
import { subscriptionController } from '../../container.js';
import { apiKeyAuth } from '../../platform/http/api-key-auth.js';

const router = Router();

router.post('/subscribe', apiKeyAuth, async (req, res, next) =>
  subscriptionController.subscribe(req, res, next),
);

router.get('/confirm/:token', async (req, res, next) =>
  subscriptionController.confirmSubscription(req, res, next),
);

router.get('/unsubscribe/:token', async (req, res, next) =>
  subscriptionController.unsubscribe(req, res, next),
);

router.get('/subscriptions', async (req, res, next) =>
  subscriptionController.getSubscriptions(req, res, next),
);

export default router;
