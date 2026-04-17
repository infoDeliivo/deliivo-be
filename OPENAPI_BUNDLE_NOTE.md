# OpenAPI Bundle Note

## Issue
The new public profile API endpoint was not visible in Swagger UI even though it was added to the OpenAPI YAML files.

## Root Cause
The application serves OpenAPI documentation from a **bundled JSON file** at:
```
docs/openapi/dist/openapi.json
```

This file is generated from the YAML source files and needs to be regenerated whenever changes are made to:
- `docs/openapi/openapi.yaml`
- `docs/openapi/paths/*.yaml`
- `docs/openapi/components/*.yaml`

## Solution

### Step 1: Bundle the OpenAPI Specification
Run this command to regenerate the bundled JSON file:
```bash
npm run openapi:bundle
```

This command:
1. Reads `docs/openapi/openapi.yaml`
2. Resolves all `$ref` references to other YAML files
3. Bundles everything into a single JSON file
4. Outputs to `docs/openapi/dist/openapi.json`

### Step 2: Restart the Server
After bundling, restart your development server:
```bash
npm run dev
```

### Step 3: Verify in Swagger
Visit Swagger UI and verify the endpoint appears:
```
http://localhost:3000/docs
```

Look for:
```
GET /api/v1/users/{userId}/profile
```

## Complete OpenAPI Workflow

Whenever you add or modify OpenAPI documentation:

```bash
# 1. Lint the OpenAPI files (check for errors)
npm run openapi:lint

# 2. Bundle the YAML files into JSON
npm run openapi:bundle

# 3. Check coverage (verify all endpoints are documented)
npm run openapi:coverage

# Or run all three at once:
npm run openapi:check
```

## Files Modified for Public Profile API

1. ✅ `docs/openapi/paths/users.yaml` - Added endpoint definition
2. ✅ `docs/openapi/components/examples/common.yaml` - Added example response
3. ✅ `docs/openapi/openapi.yaml` - Registered the path reference
4. ⏳ `docs/openapi/dist/openapi.json` - **Needs to be regenerated with bundle command**

## Why This Approach?

The bundled JSON approach has several benefits:
- **Performance**: Single file is faster to load than multiple YAML files
- **Compatibility**: JSON is universally supported by OpenAPI tools
- **Validation**: Bundling process validates all references
- **Production**: Single file is easier to deploy

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run openapi:lint` | Check YAML syntax and structure |
| `npm run openapi:bundle` | Generate bundled JSON file |
| `npm run openapi:coverage` | Verify all endpoints documented |
| `npm run openapi:check` | Run all three checks |

## Troubleshooting

### Endpoint still not visible after bundling?
1. Check if bundle command succeeded without errors
2. Verify `docs/openapi/dist/openapi.json` was updated (check timestamp)
3. Clear browser cache and refresh Swagger UI
4. Restart the server

### Bundle command fails?
1. Run `npm run openapi:lint` to check for YAML errors
2. Verify all `$ref` paths are correct
3. Check that referenced files exist

### Coverage check fails?
This means there's a mismatch between:
- Endpoints implemented in code
- Endpoints documented in OpenAPI

Run `npm run openapi:coverage` to see which endpoints are missing documentation.

## Summary

**To see the new public profile API in Swagger:**
```bash
npm run openapi:bundle
# Then restart server
```

That's it! The endpoint will now be visible in Swagger UI.
