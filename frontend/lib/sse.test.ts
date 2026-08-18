import { describe, it, expect } from 'vitest';
import { parseSSE, type SSEEvent } from '@/lib/sse';

function mockStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('parseSSE', () => {
  it('parses a single data event', async () => {
    const stream = mockStream([enc('data: {"hello":"world"}\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: { hello: 'world' } });
  });

  it('handles CRLF line endings', async () => {
    const stream = mockStream([enc('data: {"a":1}\r\n\r\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: { a: 1 } });
  });

  it('parses multiple events in one chunk', async () => {
    const stream = mockStream([enc('data: {"a":1}\n\ndata: {"b":2}\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ data: { b: 2 } });
  });

  it('splits data across arbitrary byte chunks', async () => {
    const text = 'data: {"hello":"world"}\n\n';
    const stream = mockStream(text.split('').map((c) => enc(c)));
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: { hello: 'world' } });
  });

  it('handles event and id fields', async () => {
    const stream = mockStream([enc('event: update\nid: 42\ndata: {"x":1}\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: 'update', data: { x: 1 }, id: '42' });
  });

  it('handles multiline data joined by newline', async () => {
    const stream = mockStream([enc('data: line1\ndata: line2\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('line1\nline2');
  });

  it('parses [DONE] sentinel', async () => {
    const stream = mockStream([enc('data: [DONE]\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events[0]).toEqual({ event: 'done', data: null });
  });

  it('handles malformed JSON data', async () => {
    const stream = mockStream([enc('data: not-json\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events[0]).toEqual({ event: 'malformed', data: 'not-json' });
  });

  it('skips comment lines', async () => {
    const stream = mockStream([enc(':comment\ndata: {"ok":true}\n\n')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: { ok: true } });
  });

  it('aborts and throws AbortError', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(enc('data: {"keep":true}\n\n'));
      },
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(async () => {
      for await (const event of parseSSE(stream, ctrl.signal)) { void event; }
    }).rejects.toThrow('Aborted');
  });

  it('flushes incomplete frame at EOF', async () => {
    const stream = mockStream([enc('data: {"final":true}')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ data: { final: true } });
  });

  it('handles last event without trailing blank line', async () => {
    const stream = mockStream([enc('data: {"a":1}\n\ndata: {"b":2}')]);
    const events: SSEEvent[] = [];
    for await (const evt of parseSSE(stream)) events.push(evt);
    expect(events).toHaveLength(2);
  });
});
