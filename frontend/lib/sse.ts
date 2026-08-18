export interface SSEEvent {
  event?: string;
  data: unknown;
  id?: string;
}

function decodeSSEFrame(frame: string): SSEEvent {
  const lines = frame.split(/\r?\n/);
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;

  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    if (field === 'event') event = value;
    if (field === 'id') id = value;
  }

  const raw = data.join('\n');
  if (raw === '[DONE]') return { event: 'done', data: null, id };
  try { return { event, data: JSON.parse(raw), id }; }
  catch { return { event: 'malformed', data: raw, id }; }
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', cancelReader, { once: true });

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      buffer += decoder.decode(value, { stream: !done });

      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = done ? '' : frames.pop() ?? '';

      for (const frame of frames) {
        if (frame.trim()) yield decodeSSEFrame(frame);
      }

      if (done) {
        if (buffer.trim()) yield decodeSSEFrame(buffer);
        break;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
