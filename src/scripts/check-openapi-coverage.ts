import fs from 'node:fs';
import path from 'node:path';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

type MountConfig = {
  prefix: string;
  routerVar: string;
  routeFile: string;
};

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

// Endpoints intentionally hidden from public Swagger docs.
const OPENAPI_HIDDEN_ENDPOINTS = new Set<string>([
  'POST /api/v1/vehicles',
  'POST /api/v1/vehicles/upload',
  'PUT /api/v1/vehicles/{id}/update-details',
  'POST /api/v1/vehicles/{id}/image',
]);

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, 'src/app.ts');
const MODULES_INDEX_PATH = path.join(ROOT, 'src/modules/index.ts');
const OPENAPI_BUNDLE_PATH = path.join(ROOT, 'docs/openapi/dist/openapi.json');

const buildRouterImportMap = (modulesSource: string): Map<string, string> => {
  const map = new Map<string, string>();
  const importRe = /import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+['"](\.\/[^'"]+\.routes)\.js['"];/g;

  for (const match of modulesSource.matchAll(importRe)) {
    const routerVar = match[1];
    const rel = match[2].replace(/^\.\/+/, '');
    const routeFile = path.join(ROOT, 'src/modules', `${rel}.ts`);

    if (fs.existsSync(routeFile)) {
      map.set(routerVar, routeFile);
    }
  }

  return map;
};

const parseMountedRouters = (
  appSource: string,
  routerImportMap: Map<string, string>,
): MountConfig[] => {
  const mounts: MountConfig[] = [];
  const mountRe = /app\.use\(\s*(['"`])(\/api\/v1[^'"`]*)\1\s*,([\s\S]*?)\);/g;

  for (const match of appSource.matchAll(mountRe)) {
    const prefix = match[2].trim();
    const args = match[3].trim();
    const routerMatch = args.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/);

    if (!routerMatch) {
      continue;
    }

    const routerVar = routerMatch[1];
    const routeFile = routerImportMap.get(routerVar);

    if (!routeFile) {
      continue;
    }

    mounts.push({ prefix, routerVar, routeFile });
  }

  return mounts;
};

const toOpenApiPath = (mountPrefix: string, routePath: string): string => {
  const fullPath = routePath === '/' ? mountPrefix : `${mountPrefix}${routePath}`;
  return fullPath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
};

const collectImplementedEndpoints = (mounts: MountConfig[]): Set<string> => {
  const endpointSet = new Set<string>();
  const methodRe =
    /([A-Za-z_][A-Za-z0-9_]*)\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]+)\3/g;

  for (const mount of mounts) {
    const routeSource = fs.readFileSync(mount.routeFile, 'utf8');

    for (const match of routeSource.matchAll(methodRe)) {
      const method = match[2] as HttpMethod;
      const routePath = match[4];
      const openApiPath = toOpenApiPath(mount.prefix, routePath);
      endpointSet.add(`${method.toUpperCase()} ${openApiPath}`);
    }
  }

  return endpointSet;
};

const collectDocumentedEndpoints = (spec: unknown): Set<string> => {
  if (!spec || typeof spec !== 'object') {
    throw new Error('OpenAPI document is not an object.');
  }

  const typedSpec = spec as Record<string, unknown>;
  const paths = typedSpec.paths;

  if (!paths || typeof paths !== 'object') {
    throw new Error('OpenAPI document is missing a valid "paths" object.');
  }

  const endpointSet = new Set<string>();

  for (const [pathTemplate, pathItem] of Object.entries(paths as Record<string, unknown>)) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const method of METHODS) {
      if ((pathItem as Record<string, unknown>)[method]) {
        endpointSet.add(`${method.toUpperCase()} ${pathTemplate}`);
      }
    }
  }

  return endpointSet;
};

const formatEndpointList = (title: string, endpoints: string[]): string => {
  if (endpoints.length === 0) {
    return '';
  }

  return `${title}\n${endpoints.map((endpoint) => `  - ${endpoint}`).join('\n')}`;
};

const main = (): void => {
  if (!fs.existsSync(OPENAPI_BUNDLE_PATH)) {
    throw new Error(
      `OpenAPI bundle not found at ${OPENAPI_BUNDLE_PATH}. Run "npm run openapi:bundle" first.`,
    );
  }

  const appSource = fs.readFileSync(APP_PATH, 'utf8');
  const modulesSource = fs.readFileSync(MODULES_INDEX_PATH, 'utf8');
  const routerImportMap = buildRouterImportMap(modulesSource);
  const mounts = parseMountedRouters(appSource, routerImportMap);
  const implementedEndpoints = new Set(
    [...collectImplementedEndpoints(mounts)].filter(
      (endpoint) => !OPENAPI_HIDDEN_ENDPOINTS.has(endpoint),
    ),
  );

  const bundledRaw = fs.readFileSync(OPENAPI_BUNDLE_PATH, 'utf8');
  const bundledSpec = JSON.parse(bundledRaw) as unknown;
  const documentedEndpoints = collectDocumentedEndpoints(bundledSpec);

  const missingInSpec = [...implementedEndpoints]
    .filter((endpoint) => !documentedEndpoints.has(endpoint))
    .sort();
  const staleInSpec = [...documentedEndpoints]
    .filter((endpoint) => endpoint.includes('/api/v1/') && !implementedEndpoints.has(endpoint))
    .sort();

  if (missingInSpec.length > 0 || staleInSpec.length > 0) {
    const message = [
      'OpenAPI coverage check failed.',
      formatEndpointList('Endpoints implemented in code but missing from OpenAPI:', missingInSpec),
      formatEndpointList('Endpoints documented in OpenAPI but not found in mounted /api/v1 routes:', staleInSpec),
    ]
      .filter(Boolean)
      .join('\n\n');

    throw new Error(message);
  }

  console.log(`OpenAPI coverage check passed for ${implementedEndpoints.size} mounted /api/v1 endpoints.`);
};

main();
