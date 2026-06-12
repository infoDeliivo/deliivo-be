import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000';

async function proxyRequest(req: NextRequest) {
  const url = new URL(req.url);
  // Strip /api/proxy prefix to get the real backend path
  const backendPath = url.pathname.replace(/^\/api\/proxy/, '');
  const target = `${BACKEND_URL}${backendPath}${url.search}`;

  const headers = new Headers();
  // Forward relevant headers
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = await req.arrayBuffer();
  }

  try {
    const res = await fetch(target, init);
    const body = await res.arrayBuffer();

    return new NextResponse(body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { message: `Proxy error: ${message}` },
      { status: 502 }
    );
  }
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
