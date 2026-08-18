import { GoogleAuth, type IdTokenClient } from 'google-auth-library';

const auth = new GoogleAuth();
const clients = new Map<string, Promise<IdTokenClient>>();

function clientFor(audience: string): Promise<IdTokenClient> {
  let client = clients.get(audience);
  if (!client) {
    client = auth.getIdTokenClient(audience);
    clients.set(audience, client);
  }
  return client;
}

export async function getCloudRunAuthorization(targetUrl: string): Promise<Record<string, string>> {
  if (!process.env.K_SERVICE) return {};

  const audience = new URL(targetUrl).origin;
  const client = await clientFor(audience);
  const token = await client.idTokenProvider.fetchIdToken(audience);
  return { 'X-Serverless-Authorization': `Bearer ${token}` };
}
