import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { hostPort, unbracketHost } from '../endpoints.mjs';
import { toOpenAIRequest, fromOpenAIResponse } from './claude-wire.mjs';
import { convertOpenAIStream, readSse } from './claude-stream.mjs';

function requestUpstream(url, headers, payload, proxy, signal, ca) {
  let agent;
  if (proxy) {
    const via = new URL(proxy);
    agent = new https.Agent();
    agent.createConnection = (_options, callback) => {
      const connect = (via.protocol === 'https:' ? https : http).request(via, { method: 'CONNECT',
        path: hostPort(url.hostname, url.port || 443), signal,
        headers: { Host: hostPort(url.hostname, url.port || 443),
          ...(via.username ? { 'Proxy-Authorization': `Basic ${Buffer.from(`${decodeURIComponent(via.username)}:${decodeURIComponent(via.password)}`).toString('base64')}` } : {}) } });
      connect.once('error', callback);
      connect.once('connect', (res, socket, head) => {
        if (res.statusCode !== 200) { socket.destroy(); callback(new Error('代理隧道建立失败')); return; }
        if (head.length) socket.unshift(head);
        const secured = tls.connect({ socket, servername: unbracketHost(url.hostname), ...(ca ? { ca } : {}) });
        secured.once('error', callback);
        secured.once('secureConnect', () => { secured.removeListener('error', callback); callback(null, secured); });
      });
      connect.end();
    };
  }
  return new Promise((resolve, reject) => {
    // 公网凭据仅通过 TLS 传输；HTTP 仅用于用户明确配置的本地服务。
    if (proxy && url.protocol !== 'https:') { agent.destroy(); reject(new Error('本地 HTTP 上游请使用直接联网')); return; }
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'POST', headers, agent, signal, ...(ca ? { ca } : {}) }, response => {
      response.once('close', () => agent?.destroy()); resolve(response);
    });
    request.once('error', error => { agent?.destroy(); reject(error); });
    request.end(payload);
  });
}

async function boundedJson(stream, limit = 8388608) {
  let bytes = 0; const chunks = [];
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('消息超出大小限制');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('消息不是有效 JSON'); }
}

export async function startClaudeGateway({ profile, proxy = null, onRecord = () => {}, timeoutMs = 120000, ca } = {}) {
  const token = randomBytes(32).toString('hex');
  const sockets = new Set();
  let writes = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    const supplied = req.headers['x-api-key'] || req.headers.authorization?.replace(/^Bearer /, '') || '';
    if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== token.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) {
      req.resume(); res.writeHead(401); res.end(); return;
    }
    if (req.method !== 'POST' || req.url?.split('?')[0] !== '/v1/messages') { req.resume(); res.writeHead(404); res.end(); return; }
    const started = Date.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    let record = { providerId: profile.id, providerName: profile.name, model: profile.model, protocol: profile.protocol, status: 502, durationMs: 0, firstByteMs: null,
      inputTokens: null, outputTokens: null };
    try {
      const body = await boundedJson(req);
      const native = profile.protocol === 'anthropic';
      const outgoing = native ? body : toOpenAIRequest(body, profile, { stream: Boolean(body.stream) });
      record.model = outgoing.model || profile.model;
      const root = profile.baseUrl.replace(/\/+$/, '');
      const prefix = /\/v1$/.test(root) ? root : `${root}/v1`;
      const url = new URL(`${prefix}/${native ? 'messages' : profile.protocol === 'openai-chat' ? 'chat/completions' : 'responses'}`);
      const headers = { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity',
        ...(native && profile.authType === 'api-key' ? { 'x-api-key': profile.secret } : { Authorization: `Bearer ${profile.secret}` }),
        ...(native ? { 'anthropic-version': '2023-06-01',
          ...(typeof req.headers['anthropic-beta'] === 'string' && req.headers['anthropic-beta'].length < 2048
            ? { 'anthropic-beta': req.headers['anthropic-beta'] } : {}) } : {}) };
      const upstream = await requestUpstream(url, headers, JSON.stringify(outgoing), proxy, controller.signal, ca);
      record.status = upstream.statusCode;
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        upstream.resume(); throw new Error('上游请求失败');
      }
      const write = async chunk => {
        if (record.firstByteMs === null) record.firstByteMs = Date.now() - started;
        if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
      };
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        if (native) {
          let stopped = false;
          for await (const event of readSse(upstream)) {
            if (!event || typeof event.type !== 'string' || !/^[a-z_]+$/.test(event.type)) throw new Error('无效的原生流式事件');
            if (event.type === 'message_start') {
              record.inputTokens = event.message?.usage?.input_tokens ?? null;
              record.outputTokens = event.message?.usage?.output_tokens ?? null;
            }
            if (event.type === 'message_delta') {
              record.inputTokens = event.usage?.input_tokens ?? record.inputTokens;
              record.outputTokens = event.usage?.output_tokens ?? record.outputTokens;
            }
            if (event.type === 'message_stop') stopped = true;
            if (event.type === 'error') record.status = 502;
            await write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          }
          if (!stopped) throw new Error('原生响应中断');
        }
        else for await (const event of convertOpenAIStream(upstream, profile, body.model, { onUsage: usage => {
          record.inputTokens = usage.input_tokens; record.outputTokens = usage.output_tokens;
        } })) {
          await write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      } else {
        const data = await boundedJson(upstream);
        const message = native ? data : fromOpenAIResponse(data, profile, body.model);
        record.inputTokens = (profile.protocol === 'openai-chat' ? data.usage?.prompt_tokens : data.usage?.input_tokens) ?? null;
        record.outputTokens = (profile.protocol === 'openai-chat' ? data.usage?.completion_tokens : data.usage?.output_tokens) ?? null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        await write(JSON.stringify(message)); res.end();
      }
    } catch {
      record.status = record.status >= 400 ? record.status : 502;
      if (!res.headersSent) { res.writeHead(record.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: '请求未完成，请检查服务连接或接口兼容性' } })); }
      else res.end('event: error\ndata: {"type":"error","error":{"type":"api_error","message":"上游响应中断"}}\n\n');
    } finally {
      clearTimeout(timer); controller.abort(); record.durationMs = Date.now() - started;
      writes = writes.then(() => onRecord(record)).catch(() => {});
      await writes;
    }
  });
  server.requestTimeout = timeoutMs; server.headersTimeout = Math.min(timeoutMs, 10000);
  server.maxHeadersCount = 32;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, token,
    close: async () => {
      await new Promise(resolve => { server.close(resolve); for (const socket of sockets) socket.destroy(); });
      await writes;
    } };
}
