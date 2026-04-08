import { Router } from 'express';
import { BroadcastController } from '../controllers/broadcast.controller';

const BASE = '/broadcasts';

export function createBroadcastRoutes(controller: BroadcastController): Router {
  const router = Router();

  router.get(BASE, controller.listBroadcasts); // GET  /broadcasts
  router.post(BASE, controller.sendBroadcast); // POST /broadcasts

  return router;
}
