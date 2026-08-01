/**
 * The Stripe webhook needs the unparsed request body to verify its signature, so express.raw()
 * is mounted before express.json(). Scoping that raw parser to the whole /api/v1/payments prefix
 * silently breaks every other payments route: body-parser leaves an already-parsed body alone, so
 * express.json() skips them and their handlers see a Buffer instead of fields. This asserts the
 * two parsers keep to their own paths.
 */
import express from 'express';
import request from 'supertest';

const buildApp = () => {
  const app = express();
  const webhookRouter = express.Router();
  webhookRouter.post('/stripe/webhook', (req, res) => {
    res.json({ isBuffer: Buffer.isBuffer(req.body) });
  });

  // Mirrors src/app.ts.
  app.use('/api/v1/payments/stripe/webhook', express.raw({ type: 'application/json' }));
  app.use('/api/v1/payments', webhookRouter);
  app.use(express.json({ limit: '50kb' }));

  app.put('/api/v1/payments/connect/details', (req, res) => {
    res.json({ body: req.body, isBuffer: Buffer.isBuffer(req.body) });
  });

  return app;
};

describe('payments body parsing', () => {
  it('hands the Stripe webhook the raw body', async () => {
    const res = await request(buildApp())
      .post('/api/v1/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ id: 'evt_1' }));

    expect(res.status).toBe(200);
    expect(res.body.isBuffer).toBe(true);
  });

  it('hands the other payments routes parsed JSON', async () => {
    const res = await request(buildApp())
      .put('/api/v1/payments/connect/details')
      .set('Content-Type', 'application/json')
      .send({ firstName: 'John', address: { city: 'Tallinn' } });

    expect(res.status).toBe(200);
    expect(res.body.isBuffer).toBe(false);
    expect(res.body.body).toEqual({ firstName: 'John', address: { city: 'Tallinn' } });
  });
});
