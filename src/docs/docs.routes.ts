import { Router, type RequestHandler, type Response } from 'express';
import { loadOpenApiSpec } from './openapi.spec.js';

const router = Router();

const swaggerUiCssUrl = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css';
const swaggerUiBundleUrl = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js';
const swaggerUiPresetUrl = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js';

const docsContentSecurityPolicy = [
  "default-src 'self' https: data: blob:",
  "connect-src 'self' https:",
  "img-src 'self' https: data: blob:",
  "script-src 'self' https: 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' https: 'unsafe-inline'",
  "font-src 'self' https: data:",
  "frame-ancestors 'self'",
].join('; ');

const sendSpecError = (res: Response, error: unknown) => {
  const message = error instanceof Error ? error.message : 'Failed to load OpenAPI spec';

  return res.status(500).json({
    success: false,
    message,
  });
};

const getOpenApiJson: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const spec = loadOpenApiSpec();
    return res.status(200).json(spec);
  } catch (error) {
    return sendSpecError(res, error);
  }
};

const getDocs: RequestHandler = (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    loadOpenApiSpec();
  } catch (error) {
    return sendSpecError(res, error);
  }

  res.setHeader('Content-Security-Policy', docsContentSecurityPolicy);
  res.type('html');

  return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Carpooling API Docs</title>
    <link rel="stylesheet" href="${swaggerUiCssUrl}" />
    <style>
      html { box-sizing: border-box; overflow-y: scroll; }
      *, *:before, *:after { box-sizing: inherit; }
      body { margin: 0; background: #fafafa; }
      #swagger-ui { min-height: 100vh; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${swaggerUiBundleUrl}"></script>
    <script src="${swaggerUiPresetUrl}"></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: '/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          displayRequestDuration: true,
          persistAuthorization: true,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'StandaloneLayout',
        });
      };
    </script>
  </body>
</html>`);
};

router.get('/openapi.json', getOpenApiJson);
router.get('/docs', getDocs);

export default router;
