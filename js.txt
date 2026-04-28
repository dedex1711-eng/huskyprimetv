// HuskyPlay CORS Proxy
// Cole este código no editor do Cloudflare Workers (workers.cloudflare.com)

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const target = url.searchParams.get('url');

  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  try {
    const res = await fetch(target, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 HuskyPlay/1.0' },
    });

    const contentType = res.headers.get('content-type') || 'application/json';
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
        ...corsHeaders,
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}
