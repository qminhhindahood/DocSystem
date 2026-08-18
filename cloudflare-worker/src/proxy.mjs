function rewriteLocation(location, upstreamOrigin, publicOrigin) {
  if (!location) return location;

  const target = new URL(location, upstreamOrigin);
  if (target.origin !== upstreamOrigin) return location;

  return `${publicOrigin}${target.pathname}${target.search}${target.hash}`;
}

export function createProxyHandler({ upstreamOrigin, fetchUpstream = fetch }) {
  const normalizedUpstream = new URL(upstreamOrigin).origin;

  return async function proxy(request) {
    const publicUrl = new URL(request.url);
    const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, normalizedUpstream);
    const headers = new Headers(request.headers);
    const connectingIp = headers.get('cf-connecting-ip');
    if (connectingIp) headers.set('x-forwarded-for', connectingIp);
    else headers.delete('x-forwarded-for');
    headers.set('x-forwarded-host', publicUrl.host);
    headers.set('x-forwarded-proto', publicUrl.protocol.slice(0, -1));

    const requestInit = {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    };
    if (request.body) requestInit.duplex = 'half';
    const upstreamRequest = new Request(upstreamUrl, requestInit);
    const upstreamResponse = await fetchUpstream(upstreamRequest);
    const responseHeaders = new Headers(upstreamResponse.headers);
    const location = responseHeaders.get('location');
    if (location) {
      responseHeaders.set('location', rewriteLocation(location, normalizedUpstream, publicUrl.origin));
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  };
}
