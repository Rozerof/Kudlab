import { Hono, type Context } from 'hono';
import type { AuthVariables } from '../../../auth/session-guard.js';
import { loadEnv } from '../../../config/env.js';
import { academicActor } from '../../academico/shared/academic-auth.js';
import { academicFail, forbidden, invalidInput } from '../../academico/shared/academic.errors.js';
import { createPanel, groupPriority, listPanels } from './panel.service.js';

async function json(c: Context) {
  if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw invalidInput();
  const text = await c.req.text(); if (text.length > 16384) throw invalidInput();
  return JSON.parse(text) as unknown;
}
export function createPanelRoutes() {
  const routes = new Hono<AuthVariables>();
  routes.onError((error, c) => { c.header('Cache-Control', 'no-store'); return academicFail(c, error); });
  routes.get('/api/v1/students/:id/observation-panels', async c => { c.header('Cache-Control', 'no-store'); return c.json(await listPanels(academicActor(c), c.req.param('id'))); });
  routes.post('/api/v1/students/:id/observation-panels', async c => {
    if (c.req.header('Origin') !== loadEnv().SPA_ORIGIN) throw forbidden();
    const r = await createPanel(academicActor(c), c.req.param('id'), await json(c));
    return c.json(r.detail, r.repeated ? 200 : 201);
  });
  routes.get('/api/v1/groups/:id/review-priority', async c => { c.header('Cache-Control', 'no-store'); return c.json(await groupPriority(academicActor(c), c.req.param('id'))); });
  return routes;
}
