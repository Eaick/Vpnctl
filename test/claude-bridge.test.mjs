import test from 'node:test';
import assert from 'node:assert/strict';
import { toOpenAIRequest, fromOpenAIResponse, anthropicEvents } from '../src/lib/integrations/claude-wire.mjs';
import { readSse, convertOpenAIStream } from '../src/lib/integrations/claude-stream.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startClaudeGateway } from '../src/lib/integrations/claude-gateway.mjs';

test('HTTPS upstream uses CONNECT and validates certificates instead of bypassing TLS', async t => {
  const openssl = process.env.VPNCTL_TEST_OPENSSL || 'openssl';
  if (spawnSync(openssl, ['version']).status !== 0) { t.skip('OpenSSL unavailable'); return; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpnctl-tls-'));
  let upstream, proxy; const sockets = new Set();
  try {
    const keyPath = path.join(dir, 'key.pem'), certPath = path.join(dir, 'cert.pem');
    const generated = spawnSync(openssl, ['req', '-config', process.platform === 'win32' ? 'NUL' : '/dev/null', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost', '-keyout', keyPath, '-out', certPath], { encoding: 'utf8', timeout: 20000 });
    assert.equal(generated.status, 0, 'local certificate generation failed');
    const cert = await fs.readFile(certPath), key = await fs.readFile(keyPath);
    upstream = https.createServer({ key, cert }, async (req, res) => {
      for await (const _chunk of req) { /* 消费模拟请求。 */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'tls-fixture-ok' }, finish_reason: 'stop' }] }));
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    let connects = 0;
    proxy = http.createServer();
    proxy.on('connect', (req, client, head) => {
      connects++;
      assert.equal(req.url, `localhost:${upstream.address().port}`);
      assert.equal(req.headers.host, req.url);
      const remote = net.connect(upstream.address().port, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection established\r\n\r\n');
        if (head.length) remote.write(head);
        client.pipe(remote); remote.pipe(client);
      });
      for (const socket of [client, remote]) {
        sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
      }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    for (const trusted of [true, false]) {
      const gateway = await startClaudeGateway({ profile: { protocol: 'openai-chat', model: 'fixture', secret: 'fixture',
        baseUrl: `https://localhost:${upstream.address().port}/v1` }, proxy: `http://127.0.0.1:${proxy.address().port}`, ...(trusted ? { ca: cert } : {}) });
      try {
        const response = await fetch(`${gateway.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': gateway.token },
          body: JSON.stringify({ messages: [], max_tokens: 10 }) });
        assert.equal(response.status, trusted ? 200 : 502);
        await response.text();
      } finally { await gateway.close(); }
    }
    assert.equal(connects, 2);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (proxy) await new Promise(resolve => proxy.close(resolve));
    if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('local Claude gateway authenticates sessions and converts actual streamed and JSON HTTP responses', async () => {
  const records = [];
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fixture-upstream-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(sse({ choices: [{ index: 0, delta: { content: 'hello' } }] }));
      res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      res.end('data: [DONE]\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }));
    }
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = await startClaudeGateway({ profile: { id: 'fixture', protocol: 'openai-chat', model: 'fixture-model',
    baseUrl: `http://127.0.0.1:${upstream.address().port}`, secret: 'fixture-upstream-key' }, onRecord: record => records.push(record) });
  try {
    const denied = await fetch(`${gateway.baseUrl}/v1/messages`, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401); await denied.text();
    for (const stream of [false, true]) {
      const result = await fetch(`${gateway.baseUrl}/v1/messages`, { method: 'POST', headers: { Authorization: `Bearer ${gateway.token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'private prompt fixture' }], max_tokens: 30, stream }) });
      assert.equal(result.status, 200);
      const output = await result.text();
      if (stream) { assert.match(output, /message_stop/); assert.match(output, /hello/); }
      else assert.equal(JSON.parse(output).content[0].text, 'hello');
    }
    assert.equal(records.length, 2);
    assert.equal(records[0].outputTokens, 3);
    assert.equal(records[1].outputTokens, null, 'an omitted upstream usage is not zero');
    assert.ok(!JSON.stringify(records).includes('private prompt fixture'));
    assert.ok(!JSON.stringify(records).includes('fixture-upstream-key'));
  } finally { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});

const sse = value => Buffer.from(`data: ${JSON.stringify(value)}\n\n`);
async function* pieces(values) { yield* values; }
async function collect(iterator) { const values = []; for await (const value of iterator) values.push(value); return values; }

test('Responses conversion reaches an IPv6 loopback upstream with both JSON and streaming requests', async t => {
  const upstream = http.createServer(async (req, res) => {
    assert.equal(req.url, '/v1/responses');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw);
    assert.equal(request.model, 'fixture-model');
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(sse({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'ipv6-response' }));
      res.end(sse({ type: 'response.completed', response: { usage: { input_tokens: 3, output_tokens: 4 } } }));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ipv6-response' }] }], usage: { input_tokens: 3, output_tokens: 4 } }));
    }
  });
  try { await new Promise((resolve, reject) => { upstream.once('error', reject); upstream.listen(0, '::1', resolve); }); }
  catch (error) {
    if (['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code)) { t.skip('IPv6 loopback unavailable'); return; }
    throw error;
  }
  const records = [];
  const gateway = await startClaudeGateway({ profile: { protocol: 'openai-responses', model: 'fixture-model', secret: 'fixture-key',
    baseUrl: `http://[::1]:${upstream.address().port}/v1` }, onRecord: record => records.push(record) });
  try {
    for (const stream of [false, true]) {
      const result = await fetch(`${gateway.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': gateway.token },
        body: JSON.stringify({ model: 'default', messages: [{ role: 'user', content: 'fixture' }], max_tokens: 30, stream }) });
      assert.equal(result.status, 200);
      assert.match(await result.text(), /ipv6-response/);
    }
    await gateway.close();
    assert.equal(records.length, 2);
    assert.equal(records[1].outputTokens, 4);
  } finally { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});

test('native Claude streaming reports actual usage and close waits for pending monitoring writes', async () => {
  const upstream = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* 消费请求体，模拟原生服务。 */ }
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(sse({ type: 'message_start', message: { usage: { input_tokens: 11, output_tokens: 0 } } }));
    res.write(sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }));
    res.end(sse({ type: 'message_stop' }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let recorded;
  const gateway = await startClaudeGateway({ profile: { protocol: 'anthropic', authType: 'api-key', secret: 'fixture',
    baseUrl: `http://127.0.0.1:${upstream.address().port}` }, onRecord: async record => {
      await new Promise(resolve => setTimeout(resolve, 20)); recorded = record;
    } });
  try {
    const result = await fetch(`${gateway.baseUrl}/v1/messages`, { method: 'POST', headers: { 'x-api-key': gateway.token },
      body: JSON.stringify({ stream: true, messages: [], max_tokens: 30 }) });
    assert.match(await result.text(), /message_stop/);
    await gateway.close();
    assert.equal(recorded.inputTokens, 11);
    assert.equal(recorded.outputTokens, 7);
  } finally { await gateway.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
});

test('SSE decoding preserves split UTF8 and CRLF boundaries', async () => {
  const bytes = Buffer.from('data: {"text":"测试"}\r\n\r\n');
  const decoded = await collect(readSse(pieces([...bytes].map(value => Buffer.from([value])))));
  assert.deepEqual(decoded, [{ text: '测试' }]);
});

test('Chat streaming emits text before reading later chunks and preserves split tool arguments', async () => {
  let advanced = false;
  async function* upstream() {
    yield sse({ choices: [{ index: 0, delta: { content: 'Hello' } }] });
    advanced = true;
    yield sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'Read', arguments: '{"path":' } }] } }] });
    yield sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, finish_reason: 'tool_calls' }] });
    yield sse({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 9 } });
    yield Buffer.from('data: [DONE]\n\n');
  }
  const stream = convertOpenAIStream(upstream(), { protocol: 'openai-chat', model: 'fixture' });
  assert.equal((await stream.next()).value.type, 'message_start');
  await stream.next();
  assert.equal((await stream.next()).value.delta.text, 'Hello');
  assert.equal(advanced, false);
  const rest = await collect(stream);
  assert.equal(rest.at(-1).type, 'message_stop');
  assert.equal(rest.at(-2).delta.stop_reason, 'tool_use');
  assert.equal(rest.at(-2).usage.input_tokens, 8);
});

test('Responses streams convert text and tool arguments and reject interrupted output', async () => {
  const events = [
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello' },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'call_b', name: 'Read' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{}' },
    { type: 'response.completed', response: { usage: { input_tokens: 4, output_tokens: 5 } } }
  ];
  const converted = await collect(convertOpenAIStream(pieces(events.map(sse)), { protocol: 'openai-responses', model: 'fixture' }));
  assert.equal(converted.at(-2).delta.stop_reason, 'tool_use');
  assert.equal(converted.at(-1).type, 'message_stop');
  await assert.rejects(collect(convertOpenAIStream(pieces(events.slice(0, 1).map(sse)), { protocol: 'openai-responses' })), /中断/);
  await assert.rejects(collect(convertOpenAIStream(pieces([sse({ error: { message: 'sensitive-fixture' } })]), { protocol: 'openai-chat' })), /上游返回流式错误/);
});

const profile = { protocol: 'openai-chat', model: 'upstream-main', sonnet: 'upstream-fast', tokenField: 'max_tokens' };
const request = { model: 'sonnet', max_tokens: 100, system: [{ type: 'text', text: 'system' }], messages: [
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: [{ type: 'tool_use', id: 'call_a', name: 'Read', input: { path: 'a.txt' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_a', content: 'file contents' }] }
], tools: [{ name: 'Read', description: 'read file', input_schema: { type: 'object' } }] };

test('Anthropic text, model aliases and tool history map to OpenAI Chat Completions', () => {
  const result = toOpenAIRequest(request, profile);
  assert.equal(result.model, 'upstream-fast');
  assert.equal(result.stream, false);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages[2].tool_calls[0].id, 'call_a');
  assert.equal(result.messages[3].role, 'tool');
  assert.equal(result.messages[3].tool_call_id, 'call_a');
  assert.equal(toOpenAIRequest({ ...request, model: 'default' }, { ...profile, model: 'fixture[1m]' }).model, 'fixture');
});

test('OpenAI tool calls convert to Anthropic tools and a complete SSE lifecycle', () => {
  const message = fromOpenAIResponse({ choices: [{ message: { content: 'ok', tool_calls: [{ id: 'call_b', type: 'function', function: { name: 'Read', arguments: '{"path":"b.txt"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 9 } }, profile, 'sonnet');
  assert.equal(message.stop_reason, 'tool_use');
  assert.equal(message.content[1].input.path, 'b.txt');
  const events = anthropicEvents(message);
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'message_stop');
  assert.ok(events.some(event => event.type === 'content_block_delta' && event.delta.type === 'input_json_delta'));
});
