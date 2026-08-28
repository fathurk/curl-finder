process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { server, startServer } from '../src/server.js';

let testPort = 0;

function httpRequest(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://localhost:${testPort}${path}`, options, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: raw,
          json
        });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('Server Integration Tests', async (t) => {
  // Start server on dynamic port
  await startServer(0);
  testPort = server.address().port;

  await t.test('GET /api/health returns ok status', async () => {
    const res = await httpRequest('/api/health');
    assert.equal(res.statusCode, 200);
    assert.equal(res.json.status, 'ok');
  });

  await t.test('GET /api/samples returns preset samples', async () => {
    const res = await httpRequest('/api/samples');
    assert.equal(res.statusCode, 200);
    assert.ok(res.json.jsonLogs);
    assert.ok(res.json.nginxLogs);
    assert.ok(res.json.debugLogs);
    assert.ok(res.json.rawHttpLogs);
  });

  await t.test('POST /api/parse parses log text and returns curl commands', async () => {
    const logSnippet = `192.168.1.1 - - [28/Aug/2026] "POST /api/v1/orders HTTP/1.1" 201 100\n{"req":{"method":"GET","url":"/api/v1/items"}}`;
    const res = await httpRequest('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      text: logSnippet,
      baseUrl: 'https://api.mytestapp.com',
      multiline: true
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.count, 2);
    assert.equal(res.json.requests[0].method, 'POST');
    assert.match(res.json.requests[0].curlCommand, /https:\/\/api\.mytestapp\.com\/api\/v1\/orders/);
    assert.equal(res.json.requests[1].method, 'GET');
  });

  await t.test('POST /api/export returns downloadable bash script', async () => {
    const res = await httpRequest('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      requests: [
        {
          method: 'GET',
          url: 'https://example.com/api',
          lineNumber: 1,
          curlCommand: "curl 'https://example.com/api'"
        }
      ],
      multiline: false
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'], /^application\/x-sh/);
    assert.match(res.body, /^#!/);
    assert.match(res.body, /curl 'https:\/\/example\.com\/api'/);
  });

  await t.test('GET / serves index.html', async () => {
    const res = await httpRequest('/');
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /cURL Finder/);
  });

  // Close test server
  t.after(() => {
    server.close();
  });
});
