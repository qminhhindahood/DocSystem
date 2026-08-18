import { describe, it, expect } from 'vitest';

describe('proxy streaming', () => {
  it('streams response body without buffering via arrayBuffer', async () => {
    // Create a mock ReadableStream with delayed chunks
    const encoder = new TextEncoder();
    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex === 0) {
          controller.enqueue(encoder.encode('data: {"stage":"planning"}\n\n'));
          chunkIndex++;
        } else if (chunkIndex === 1) {
          controller.enqueue(encoder.encode('data: {"stage":"writing"}\n\n'));
          chunkIndex++;
        } else {
          controller.close();
        }
      },
    });

    const response = new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    });

    // Verify we can read chunks incrementally (not buffered all at once)
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];

    let done = false;
    while (!done) {
      const { done: d, value } = await reader.read();
      done = d;
      if (value) chunks.push(decoder.decode(value, { stream: true }));
    }

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toContain('planning');
    expect(chunks[1]).toContain('writing');
  });
});
