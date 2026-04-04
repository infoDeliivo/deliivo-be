import * as fs from 'node:fs';
import path from 'node:path';

export type OpenApiSpec = Record<string, unknown>;

export const openApiSpecPath = path.resolve(process.cwd(), 'docs/openapi/dist/openapi.json');

export const loadOpenApiSpec = (): OpenApiSpec => {
  if (!fs.existsSync(openApiSpecPath)) {
    throw new Error(`OpenAPI spec not found at ${openApiSpecPath}`);
  }

  const rawSpec = fs.readFileSync(openApiSpecPath, 'utf8');

  try {
    return JSON.parse(rawSpec) as OpenApiSpec;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse failure';
    throw new Error(`Failed to parse OpenAPI spec at ${openApiSpecPath}: ${message}`);
  }
};
