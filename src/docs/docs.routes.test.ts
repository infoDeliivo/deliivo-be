jest.mock('node:fs', () => {
  const actualFs = jest.requireActual<typeof import('node:fs')>('node:fs');

  return {
    ...actualFs,
    existsSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

import request from 'supertest';
import * as fs from 'node:fs';
import app from '../app.js';
import { openApiSpecPath } from './openapi.spec.js';

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Carpooling API',
    version: '1.0.0',
  },
  paths: {},
};

describe('docs endpoints', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('serves openapi.json', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(openApiSpec) as never);

    const res = await request(app).get('/openapi.json');

    expect(res.status).toBe(200);
    expect(res.type).toContain('json');
    expect(res.body).toEqual(openApiSpec);
  });

  it('serves swagger docs page', async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify(openApiSpec) as never);

    const res = await request(app).get('/docs');

    expect(res.status).toBe(200);
    expect(res.type).toContain('html');
    expect(res.text).toContain('SwaggerUIBundle');
    expect(res.text).toContain('/openapi.json');
    expect(res.text).toContain('swagger-ui-dist');
  });

  it.each(['/openapi.json', '/docs'])(
    'returns a 500 JSON error when the spec file is missing for %s',
    async (route) => {
      mockedExistsSync.mockReturnValue(false);

      const res = await request(app).get(route);

      expect(res.status).toBe(500);
      expect(res.type).toContain('json');
      expect(res.body).toEqual({
        success: false,
        message: `OpenAPI spec not found at ${openApiSpecPath}`,
      });
    },
  );
});
