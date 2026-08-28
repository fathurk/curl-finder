import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonLog } from '../src/parser/jsonParser.js';
import { parseAccessLog } from '../src/parser/accessLogParser.js';
import { parseDebugLog } from '../src/parser/debugLogParser.js';
import { parseRawHttpRequest } from '../src/parser/rawHttpParser.js';
import { parseLogs } from '../src/parser/index.js';
import { buildCurlCommand, escapeShellArg } from '../src/builder/curlBuilder.js';
import { parseJsObjectLog } from '../src/parser/jsObjectParser.js';

test('1. JSON Log Parser', async (t) => {
  await t.test('parses standard Express/Pino structured log', () => {
    const jsonStr = JSON.stringify({
      level: 'info',
      time: 1724838000,
      req: {
        method: 'POST',
        url: '/api/v1/users',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token'
        },
        body: { name: 'Alice', role: 'admin' }
      }
    });

    const parsed = parseJsonLog(jsonStr, 1);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].method, 'POST');
    assert.equal(parsed[0].url, '/api/v1/users');
    assert.equal(parsed[0].headers['Content-Type'], 'application/json');
    assert.equal(parsed[0].headers['Authorization'], 'Bearer test-token');
    assert.match(parsed[0].body, /"Alice"/);
  });

  await t.test('parses embedded JSON log in syslog line', () => {
    const logLine = '2026-08-28 10:00:00.123 [APP] INFO {"method":"PUT","url":"/api/products/42","body":{"price":99.9}}';
    const parsed = parseJsonLog(logLine, 5);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].method, 'PUT');
    assert.equal(parsed[0].url, '/api/products/42');
    assert.equal(parsed[0].lineNumber, 5);
  });
});

test('2. Access Log Parser', async (t) => {
  await t.test('parses standard Nginx Combined format', () => {
    const log = '192.168.1.50 - - [28/Aug/2026:10:30:00 +0000] "GET /api/v2/items?category=books HTTP/1.1" 200 1420 "https://shop.com" "Mozilla/5.0"';
    const parsed = parseAccessLog(log, 2);
    assert.ok(parsed);
    assert.equal(parsed.method, 'GET');
    assert.equal(parsed.url, '/api/v2/items?category=books');
    assert.equal(parsed.statusCode, 200);
    assert.equal(parsed.headers['Referer'], 'https://shop.com');
    assert.equal(parsed.headers['User-Agent'], 'Mozilla/5.0');
    assert.equal(parsed.lineNumber, 2);
  });

  await t.test('parses Envoy access log', () => {
    const envoy = '[2026-08-28T12:00:00.000Z] "POST /checkout HTTP/1.1" 201 - 0 500 10 9 "-" "curl/7.88.1" "req-abc" "api.shop.com" "10.0.0.1:80"';
    const parsed = parseAccessLog(envoy, 10);
    assert.ok(parsed);
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.url, '/checkout');
    assert.equal(parsed.statusCode, 201);
    assert.equal(parsed.headers['Host'], 'api.shop.com');
  });
});

test('3. Debug & Logfmt Parser', async (t) => {
  await t.test('parses Axios debug log', () => {
    const line = '[Axios] Request: POST https://api.example.com/v1/auth Headers: {"Authorization":"Bearer secret"} Data: {"user":"john"}';
    const parsed = parseDebugLog(line, 1);
    assert.ok(parsed);
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.url, 'https://api.example.com/v1/auth');
    assert.equal(parsed.headers['Authorization'], 'Bearer secret');
    assert.match(parsed.body, /john/);
  });

  await t.test('parses Logfmt key-value line', () => {
    const line = 'level=info method=DELETE path=/api/sessions/sess_99 host=auth.example.com status=204';
    const parsed = parseDebugLog(line, 3);
    assert.ok(parsed);
    assert.equal(parsed.method, 'DELETE');
    assert.equal(parsed.url, 'https://auth.example.com/api/sessions/sess_99');
    assert.equal(parsed.statusCode, 204);
  });

  await t.test('parses embedded cURL command in log', () => {
    const line = 'Debug HTTP: curl -X POST "https://api.com/webhooks" -H "X-Key: 123" -d \'{"event":"ok"}\'';
    const parsed = parseDebugLog(line, 1);
    assert.ok(parsed);
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.url, 'https://api.com/webhooks');
    assert.equal(parsed.headers['X-Key'], '123');
    assert.equal(parsed.body, '{"event":"ok"}');
  });
});

test('4. Raw HTTP Wire Parser', async (t) => {
  await t.test('parses multiline RFC 7230 request text', () => {
    const rawText = [
      'POST /v1/orders HTTP/1.1',
      'Host: store.internal.net',
      'Content-Type: application/json',
      'Authorization: Bearer my-key',
      '',
      '{"item_id": 999, "qty": 1}'
    ].join('\n');

    const parsed = parseRawHttpRequest(rawText, 1);
    assert.ok(parsed);
    assert.equal(parsed.method, 'POST');
    assert.equal(parsed.url, 'https://store.internal.net/v1/orders');
    assert.equal(parsed.headers['Content-Type'], 'application/json');
    assert.equal(parsed.headers['Authorization'], 'Bearer my-key');
    assert.equal(parsed.body, '{"item_id": 999, "qty": 1}');
  });
});

test('5. Parser Coordinator (parseLogs)', async (t) => {
  await t.test('auto-detects mixed log input containing multiple formats', () => {
    const mixed = [
      '192.168.1.1 - - [28/Aug/2026:10:00:00 +0000] "GET /api/v1/health HTTP/1.1" 200 12',
      '{"req":{"method":"POST","url":"/api/v1/login","body":{"user":"bob"}}}',
      '[Axios Request] DELETE https://api.example.com/v1/tokens/abc'
    ].join('\n');

    const results = parseLogs(mixed);
    assert.equal(results.length, 3);
    assert.equal(results[0].method, 'GET');
    assert.equal(results[0].url, '/api/v1/health');
    assert.equal(results[1].method, 'POST');
    assert.equal(results[1].url, '/api/v1/login');
    assert.equal(results[2].method, 'DELETE');
    assert.equal(results[2].url, 'https://api.example.com/v1/tokens/abc');
  });
});

test('6. cURL Command Generator', async (t) => {
  await t.test('generates valid multiline cURL with headers and body', () => {
    const req = {
      method: 'POST',
      url: '/api/v1/users',
      headers: {
        'Authorization': 'Bearer top-secret-token',
        'Content-Type': 'application/json'
      },
      body: '{"username":"dev"}'
    };

    const multiline = buildCurlCommand(req, {
      baseUrl: 'https://api.mycompany.com',
      multiline: true
    });

    assert.match(multiline, /^curl \\/);
    assert.match(multiline, /-X POST/);
    assert.match(multiline, /'https:\/\/api\.mycompany\.com\/api\/v1\/users'/);
    assert.match(multiline, /-H 'Authorization: Bearer top-secret-token'/);
    assert.match(multiline, /-d '\{"username":"dev"\}'/);
  });

  await t.test('generates single-line cURL with masked tokens', () => {
    const req = {
      method: 'POST',
      url: 'https://api.example.com/items',
      headers: {
        'Authorization': 'Bearer super-secret-jwt',
        'X-Api-Key': 'my-api-key'
      },
      body: '{"name":"widget"}'
    };

    const singleLine = buildCurlCommand(req, {
      multiline: false,
      maskHeaders: true
    });

    assert.ok(!singleLine.includes('\n'));
    assert.match(singleLine, /Authorization: Bearer \*\*\*\*\*\*\*\*/);
    assert.match(singleLine, /X-Api-Key: \*\*\*\*\*\*\*\*/);
  });

  await t.test('generates cURL with -v verbose flag when verbose is true', () => {
    const req = {
      method: 'GET',
      url: 'https://api.example.com/status',
      headers: {}
    };

    const verboseCurl = buildCurlCommand(req, {
      verbose: true,
      multiline: false
    });

    assert.match(verboseCurl, /-v/);
    assert.match(verboseCurl, /'https:\/\/api\.example\.com\/status'/);
  });

  await t.test('escapes quotes safely in shell arguments', () => {
    const escaped = escapeShellArg("it's a test");
    assert.equal(escaped, `'it'\\''s a test'`);
  });
});

test('7. TKE / Kubernetes Container Log Unwrapping & Reverse cURL', async (t) => {
  await t.test('correctly reconstructs POST curl from TKE container log streams', () => {
    const tkeLogs = [
      `generate curl from this --data-raw '{\\"transactionId\\":\\"41aa2202-0b65-4210-934d-449afd42d70c\\",\\"transactionDate\\":20260824161651,\\"transactionType\\":\\"PD\\",\\"transactionDescription\\":\\"Axiapp Campaign 7e7c16fe\\",\\"points\\":1000000,\\"forceTransaction\\":\\"True\\"}'","__FILENAME__":"/var/log/tke.log","__HOSTNAME__":"VM-57-45"}`,
      `{"__CONTENT__":"  -H 'Authorization: Bearer mock-tke-token-uuid-12345' \\\\","__FILENAME__":"/var/log/tke.log"}`,
      `{"__CONTENT__":"  -H 'Content-Type: application/json' \\\\","__FILENAME__":"/var/log/tke.log"}`,
      `{"__CONTENT__":"  -H 'Xc-Authorization: Bearer my-token-123' \\\\","__FILENAME__":"/var/log/tke.log"}`,
      `{"__CONTENT__":"curl -X POST 'https://gateway.egw.xl.co.id/proxy/comarch/v1/o/b2b/axiapp/customers/60265/pointsDeduct' \\\\","__FILENAME__":"/var/log/tke.log"}`
    ].join('\n');

    const results = parseLogs(tkeLogs);
    assert.equal(results.length, 1);
    assert.equal(results[0].method, 'POST');
    assert.equal(results[0].url, 'https://gateway.egw.xl.co.id/proxy/comarch/v1/o/b2b/axiapp/customers/60265/pointsDeduct');
    assert.equal(results[0].headers['Content-Type'], 'application/json');
    assert.equal(results[0].headers['Authorization'], 'Bearer mock-tke-token-uuid-12345');
    assert.equal(results[0].headers['Xc-Authorization'], 'Bearer my-token-123');
    assert.match(results[0].body, /"transactionId":"41aa2202-0b65-4210-934d-449afd42d70c"/);
    assert.match(results[0].body, /"points":1000000/);

    const generated = buildCurlCommand(results[0], { multiline: true });
    assert.match(generated, /^curl \\/);
    assert.match(generated, /-X POST/);
    assert.match(generated, /'https:\/\/gateway\.egw\.xl\.co\.id\/proxy\/comarch\/v1\/o\/b2b\/axiapp\/customers\/60265\/pointsDeduct'/);
    assert.match(generated, /-d '\{"transactionId":"41aa2202-0b65-4210-934d-449afd42d70c"/);
  });
});

test('8. JS / Python Object Dictionary Logs (API Call Events)', async (t) => {
  await t.test('parses single-quoted dictionary logs with nested data and headers', () => {
    const rawLine = `{"__CONTENT__":"[2026-08-28T12:02:43.467Z] INFO (18 on sidompul-prod): {'id':'6020e440','event':'API Call','message':'Prepare API Call','data':{'url':'https://gateway.sambas.aws.excelcom.co.id/dealermanagement-account/v1/get-profile/6287884421640/profile','method':'GET','headers':{'Content-Type':'application/json','Accept':'application/json','event_id':'6020e440','actor':'6287884421640'}}}"}`;

    const results = parseLogs(rawLine);
    assert.equal(results.length, 1);
    assert.equal(results[0].method, 'GET');
    assert.equal(results[0].url, 'https://gateway.sambas.aws.excelcom.co.id/dealermanagement-account/v1/get-profile/6287884421640/profile');
    assert.equal(results[0].headers['Content-Type'], 'application/json');
    assert.equal(results[0].headers['Accept'], 'application/json');
    assert.equal(results[0].headers['event_id'], '6020e440');
    assert.equal(results[0].headers['actor'], '6287884421640');

    const curl = buildCurlCommand(results[0], { multiline: true });
    assert.match(curl, /'https:\/\/gateway\.sambas\.aws\.excelcom\.co\.id\/dealermanagement-account\/v1\/get-profile\/6287884421640\/profile'/);
    assert.match(curl, /-H 'Content-Type: application\/json'/);
    assert.match(curl, /-H 'actor: 6287884421640'/);
  });
});

test('9. Completeness & Composition Scoring', async (t) => {
  await t.test('ranks complete POST curl higher than simple GET', () => {
    const mixed = [
      'GET /api/v1/health HTTP/1.1',
      'POST /api/v1/users HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer secret\nContent-Type: application/json\n\n{"name":"alice"}'
    ].join('\n\n');

    const results = parseLogs(mixed);
    assert.equal(results.length, 2);

    // Sort by completeness
    results.sort((a, b) => b.completenessScore - a.completenessScore);

    // POST request with body and auth headers should come first
    assert.equal(results[0].method, 'POST');
    assert.ok(results[0].completenessScore > results[1].completenessScore);
  });
});

