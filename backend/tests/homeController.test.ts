import express from 'express';
import request from 'supertest';
import * as db from '../db';
import homeRoutes from '../controllers/homeController';
import { errorHandler } from '../middleware/errorHandler';

jest.mock('../db');

describe('GET /me/home', () => {
  const app = express();
  app.use(homeRoutes);
  app.use(errorHandler);

  it('401s for guests', async () => {
    const res = await request(app).get('/me/home');
    expect(res.status).toBe(401);
    expect(db.query).not.toHaveBeenCalled();
  });
});
