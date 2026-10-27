import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowPrivateAddresses, isPrivateAddress, readText, safeFetch } from '../src/services/safe-fetch.js';

// Outbound requests for connections: never to the platform's own network, only http(s), and never an unbounded answer.
let port = 0;
const server = createServer((req, res) => {
  if (req.url === '/big') {
    res.setHeader('content-type', 'text/plain');
    res.end('x'.repeat(2048));
  } else res.end('ok');
});
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  allowPrivateAddresses(false);
  server.close();
});

describe('safe fetch', () => {
  it('knows the private ranges', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '100.64.0.1']) expect(isPrivateAddress(a)).toBe(true);
    for (const a of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111']) expect(isPrivateAddress(a)).toBe(false);
  });

  it('refuses the platform’s own network, by address and by name', async () => {
    allowPrivateAddresses(false);
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/private or internal/);
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/private or internal/);
    // A name is checked as the connection is made, so the address that was checked is the one used.
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow();
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow(/http/);
  });

  it('reaches it when the deployment allows that', async () => {
    allowPrivateAddresses(true);
    const res = await safeFetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toBe('ok');
  });

  it('stops reading an answer that is too long', async () => {
    allowPrivateAddresses(true);
    const res = await safeFetch(`http://127.0.0.1:${port}/big`);
    await expect(readText(res, 1024)).rejects.toThrow(/larger than/);
    expect((await readText(await safeFetch(`http://127.0.0.1:${port}/big`), 4096)).length).toBe(2048);
  });
});
