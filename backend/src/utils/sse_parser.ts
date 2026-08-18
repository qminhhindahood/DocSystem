import type { AxiosResponse } from 'axios';

export async function* parseSSEStream(
stream: AxiosResponse['data'],
): AsyncGenerator<string> {
let buffer = '';
for await (const chunk of stream) {
buffer += chunk.toString();
const lines = buffer.split('\n');
buffer = lines.pop() || '';
for (const line of lines) {
const trimmed = line.trim();
if (!trimmed || trimmed === 'data: [DONE]') continue;
if (!trimmed.startsWith('data: ')) continue;
try {
const data = JSON.parse(trimmed.slice(6));
// H18: surface explicit SSE errors so callers can distinguish
// "end of stream" from "model returned an error object".
if (data.error) {
throw new Error(`SSE error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`);
}
const content = data.choices?.[0]?.delta?.content;
if (content) yield content;
} catch (e) {
if (e instanceof Error && e.message.startsWith('SSE error:')) throw e;
/* skip malformed */
}
}
}
if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
try {
const prefix = buffer.trim().startsWith('data: ') ? 6 : 0;
const data = JSON.parse(buffer.trim().slice(prefix));
if (data.error) {
throw new Error(`SSE error: ${typeof data.error === 'string' ? data.error : JSON.stringify(data.error)}`);
}
const content = data.choices?.[0]?.delta?.content;
if (content) yield content;
} catch (e) {
if (e instanceof Error && e.message.startsWith('SSE error:')) throw e;
/* ignore */
}
}
}
