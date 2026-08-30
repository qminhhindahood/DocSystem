import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Default config: dummy incremental cache (the app uses no ISR/revalidate —
// pages are static and all dynamic traffic is the /api/proxy routes),
// external middleware bundled per the adapter's supported shape.
export default defineCloudflareConfig();