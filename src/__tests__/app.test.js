import request from 'supertest';
import express from 'express';

// Simple health check test to verify testing setup works
describe('Basic App Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });
  });

  it('should return 200 on health check', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should return 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown-route');
    expect(response.status).toBe(404);
  });
});
