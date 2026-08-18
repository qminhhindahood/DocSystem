import { createProxyHandler } from './proxy.mjs';

const proxy = createProxyHandler({
  upstreamOrigin: 'https://docai-frontend-in4iwfyf6q-as.a.run.app',
});

export default {
  fetch(request) {
    return proxy(request);
  },
};
