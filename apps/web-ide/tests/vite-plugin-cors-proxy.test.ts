import { describe, expect, it } from 'vitest';
import { parseWebSocketRelayRequest } from '../src/plugins/vite-plugin-cors-proxy';

function encodeRelayValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('vite cors proxy websocket relay', () => {
  it('parses relay requests and strips reserved websocket headers', () => {
    const rawUrl = `/__api/ws-relay?url=${encodeURIComponent('wss://api.anthropic.com/socket')}`
      + `&headers=${encodeURIComponent(encodeRelayValue({
        Authorization: 'Bearer test',
        Host: 'malicious.example',
        'Sec-WebSocket-Key': 'abc123',
      }))}`
      + `&protocols=${encodeURIComponent(encodeRelayValue(['json', '', 'chat']))}`;

    expect(parseWebSocketRelayRequest(rawUrl)).toEqual({
      target: new URL('wss://api.anthropic.com/socket'),
      headers: {
        Authorization: 'Bearer test',
      },
      protocols: ['json', 'chat'],
    });
  });

  it('rejects non-websocket relay targets', () => {
    expect(() => {
      parseWebSocketRelayRequest(
        `/__api/ws-relay?url=${encodeURIComponent('https://api.anthropic.com/socket')}`,
      );
    }).toThrow('Unsupported target protocol');
  });
});
