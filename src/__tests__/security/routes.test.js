import { jest } from '@jest/globals';
import request from 'supertest';
import { hashSync } from 'bcrypt';

/**
 * End-to-end checks of the real app, routers and passport strategy against
 * an in-memory stand-in for Prisma. These pin down two holes that shipped:
 * login never checked the password, and the /api/* data endpoints had no
 * auth — with no session the userid filter was undefined, which Prisma
 * drops, so every user's rows came back.
 */

const PASSWORD = 'correct-horse-battery';
const passwordHash = hashSync(PASSWORD, 4);

const users = [
  { userid: 1, email: 'owner@example.com', password: passwordHash, roleid: 1, status: 'approved' },
  { userid: 2, email: 'admin@example.com', password: passwordHash, roleid: 3, status: 'approved' },
  // Created via QuickBooks/Xero OAuth — no local password.
  { userid: 3, email: 'oauth@example.com', password: null, roleid: 1, status: 'approved' },
];

const table = () => ({
  findMany: jest.fn().mockResolvedValue([]),
  findFirst: jest.fn().mockResolvedValue(null),
  findUnique: jest.fn().mockResolvedValue(null),
});

const prisma = {
  user_table: {
    findFirst: jest.fn(async ({ where }) => {
      const email = where?.email?.equals ?? where?.email;
      return users.find((u) => u.email.toLowerCase() === String(email).toLowerCase()) ?? null;
    }),
    findUnique: jest.fn(async ({ where }) => users.find((u) => u.userid === where.userid) ?? null),
  },
  license_management: {
    findFirst: jest.fn().mockResolvedValue({ status: 'Paid' }),
  },
  company_calcs: table(),
  revenue: table(),
  costofsales: table(),
  expenses: table(),
  excel_companydata: table(),
  xero_company_calcs: table(),
  xero_expenses: table(),
  xero_revenue: table(),
  xero_costofsales: table(),
};

jest.unstable_mockModule('../../config/prismaClient.js', () => ({
  getPrismaClient: () => prisma,
  getPgPool: jest.fn(),
}));

const { default: app } = await import('../../app.js');
const { default: authRoutes } = await import('../../modules/auth/routes.js');
const { default: userRoutes } = await import('../../modules/user/routes.js');
const { default: quickbooksRoutes } = await import('../../modules/quickbooks/routes.js');
const { default: xeroRoutes } = await import('../../modules/xero/routes.js');
const { default: excelRoutes } = await import('../../modules/excel/routes.js');

app.use('/', authRoutes);
app.use('/', userRoutes);
app.use('/', quickbooksRoutes);
app.use('/', xeroRoutes);
app.use('/', excelRoutes);

const DATA_ENDPOINTS = [
  '/api/company',
  '/api/profit',
  '/api/revenue',
  '/api/costofsales',
  '/api/expenses',
  '/api/xerocompany',
  '/api/xeroprofit',
  '/api/xeroexpenses',
  '/api/xerorevenue',
  '/api/xerocostofsales',
  '/api/excompany',
  '/api/exprofit',
  '/api/exexpenses',
  '/api/ex_income',
  '/api/ex_costofsales',
];

const DATA_TABLES = [
  'company_calcs',
  'revenue',
  'costofsales',
  'expenses',
  'excel_companydata',
  'xero_company_calcs',
  'xero_expenses',
  'xero_revenue',
  'xero_costofsales',
];

function login(agent, email, password) {
  return agent.post('/login').type('form').send({ email, password });
}

beforeEach(() => {
  jest.clearAllMocks();
  // The real limiter allows 5 logins per window; each test starts fresh.
  for (const ip of ['::ffff:127.0.0.1', '127.0.0.1', '::1']) {
    app.authLimiter.resetKey(ip);
  }
});

describe('data API authentication', () => {
  it.each(DATA_ENDPOINTS)('%s rejects anonymous requests without querying', async (endpoint) => {
    const res = await request(app).get(endpoint);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Not authenticated' });
    for (const name of DATA_TABLES) {
      expect(prisma[name].findMany).not.toHaveBeenCalled();
      expect(prisma[name].findFirst).not.toHaveBeenCalled();
    }
  });

  it('scopes a logged-in user to their own rows', async () => {
    const agent = request.agent(app);
    await login(agent, 'owner@example.com', PASSWORD).expect(302);

    const res = await agent.get('/api/revenue');

    expect(res.status).toBe(200);
    expect(prisma.revenue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userid: 1 } })
    );
  });
});

describe('QuickBooks sync routes', () => {
  it.each([
    '/update',
    '/fetch-income',
    '/fetch-cost',
    '/fetch-expenses',
    '/fetch-otherexpenses',
    '/fetch-otherincome',
  ])('%s redirects anonymous requests to /login', async (route) => {
    const res = await request(app).get(route);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

describe('POST /login', () => {
  it('logs in with the correct password', async () => {
    const res = await login(request.agent(app), 'owner@example.com', PASSWORD);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('rejects a wrong password and grants no session', async () => {
    const agent = request.agent(app);
    const res = await login(agent, 'owner@example.com', 'not-the-password');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
    await agent.get('/api/revenue').expect(401);
  });

  it('does not let a known admin email in without the password', async () => {
    const agent = request.agent(app);
    const res = await login(agent, 'admin@example.com', 'guess');

    expect(res.status).toBe(200);
    expect(res.headers.location).toBeUndefined();
    await agent.get('/api/company').expect(401);
  });

  it('rejects OAuth-created accounts that have no local password', async () => {
    const res = await login(request.agent(app), 'oauth@example.com', 'anything');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('rejects an unknown email with the same message', async () => {
    const res = await login(request.agent(app), 'nobody@example.com', PASSWORD);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Invalid email or password');
  });

  it('rejects a request with no password field', async () => {
    const res = await request(app).post('/login').type('form').send({ email: 'owner@example.com' });

    expect(res.headers.location).not.toBe('/dashboard');
  });
});
