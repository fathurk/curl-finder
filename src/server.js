import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogs } from './parser/index.js';
import { buildCurlCommand } from './builder/curlBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, '../public');
const LOGS_DIR = path.join(__dirname, '../logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const DEBUG_LOG_FILE = path.join(LOGS_DIR, 'incoming_requests.log');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=UTF-8',
  '.sh': 'application/x-sh; charset=UTF-8'
};

const SAMPLE_LOGS = {
  jsonLogs: [
    JSON.stringify({
      level: "info",
      time: "2026-08-28T10:15:30.123Z",
      req: {
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          "content-type": "application/json",
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
          "x-client-id": "web-dashboard-v2"
        },
        body: {
          email: "developer@example.com",
          rememberMe: true
        }
      },
      statusCode: 200,
      responseTime: 42
    }),
    JSON.stringify({
      level: "info",
      time: "2026-08-28T10:16:05.450Z",
      req: {
        method: "GET",
        url: "/api/v1/users/profile?include=settings,permissions",
        headers: {
          "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
          "accept": "application/json"
        }
      },
      statusCode: 200
    }),
    JSON.stringify({
      level: "info",
      time: "2026-08-28T10:17:12.890Z",
      req: {
        method: "PUT",
        url: "/api/v1/orders/ORD-98431/status",
        headers: {
          "authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test",
          "content-type": "application/json"
        },
        body: {
          status: "PROCESSING",
          notes: "Paid via Stripe"
        }
      },
      statusCode: 204
    })
  ].join('\n'),

  nginxLogs: [
    `192.168.1.105 - - [28/Aug/2026:14:23:01 +0700] "GET /api/v2/products?category=electronics&limit=20 HTTP/1.1" 200 4521 "https://store.example.com" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"`,
    `192.168.1.110 - - [28/Aug/2026:14:23:15 +0700] "POST /api/v2/cart/items HTTP/1.1" 201 312 "https://store.example.com/item/123" "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"`,
    `192.168.1.120 - - [28/Aug/2026:14:24:00 +0700] "DELETE /api/v2/cart/items/55 HTTP/1.1" 204 0 "https://store.example.com/cart" "Mozilla/5.0 (Macintosh)"`,
    `10.0.0.45 - - [28/Aug/2026:14:24:45 +0700] "PATCH /api/v2/users/me/preferences HTTP/1.1" 200 89 "https://store.example.com" "Mozilla/5.0"`
  ].join('\n'),

  debugLogs: [
    `[Axios Request] POST https://api.payments.com/v1/charges Headers: {"Authorization":"Bearer sec_key_9988","Content-Type":"application/json"} Data: {"amount":4900,"currency":"usd","source":"tok_visa"}`,
    `[Axios Request] GET https://api.payments.com/v1/customers/cus_123 Headers: {"Authorization":"Bearer sec_key_9988"}`,
    `level=info method=POST path=/v1/webhooks host=webhook.service.internal status=200 payload='{"event":"payment.succeeded","id":"evt_889"}'`
  ].join('\n'),

  rawHttpLogs: [
    `POST /api/v1/checkout/session HTTP/1.1`,
    `Host: api.store.example.com`,
    `User-Agent: curl/8.4.0`,
    `Content-Type: application/json`,
    `Authorization: Bearer secret-checkout-token-xyz`,
    `Accept: application/json`,
    ``,
    `{`,
    `  "items": [`,
    `    {"sku": "PROD-101", "quantity": 2, "price": 19.99},`,
    `    {"sku": "PROD-202", "quantity": 1, "price": 49.99}`,
    `  ],`,
    `  "currency": "USD",`,
    `  "successUrl": "https://store.example.com/success"`,
    `}`
  ].join('\n'),

  tkeLogs: [
    `{"__CONTENT__":"--data-raw '{\\"transactionId\\":\\"41aa2202-0b65-4210-934d-449afd42d70c\\",\\"transactionDate\\":20260824161651,\\"transactionType\\":\\"PD\\",\\"transactionDescription\\":\\"Axiapp Campaign 7e7c16fe\\",\\"points\\":1000000,\\"forceTransaction\\":\\"True\\"}'","__FILENAME__":"/var/log/stdout.log"}`,
    `{"__CONTENT__":"  -H 'Authorization: Bearer mock-tke-token-uuid-12345' \\\\","__FILENAME__":"/var/log/stdout.log"}`,
    `{"__CONTENT__":"  -H 'Content-Type: application/json' \\\\","__FILENAME__":"/var/log/stdout.log"}`,
    `{"__CONTENT__":"  -H 'Xc-Authorization: Bearer eyJhbGciOiJSUzI1Ni... ' \\\\","__FILENAME__":"/var/log/stdout.log"}`,
    `{"__CONTENT__":"curl -X POST 'https://gateway.egw.xl.co.id/proxy/comarch/v1/o/b2b/axiapp/customers/60265/pointsDeduct' \\\\","__FILENAME__":"/var/log/stdout.log"}`
  ].join('\n')
};

/**
 * Transforms parsed requests by generating multi-line and single-line cURL commands.
 */
function enrichRequests(requests, options = {}) {
  // Sort requests by composition / completeness score (highest first)
  const sorted = [...requests].sort((a, b) => (b.completenessScore || 0) - (a.completenessScore || 0) || (a.lineNumber || 1) - (b.lineNumber || 1));

  return sorted.map(req => {
    const multilineCurl = buildCurlCommand(req, { ...options, multiline: true });
    const singlelineCurl = buildCurlCommand(req, { ...options, multiline: false });

    return {
      ...req,
      curlCommand: options.multiline === false ? singlelineCurl : multilineCurl,
      multilineCurl,
      singlelineCurl
    };
  });
}

/**
 * Computes summary statistics for parsed requests.
 */
function computeSummary(requests) {
  const methodCounts = {};
  const statusCounts = {};
  const formatCounts = {};

  requests.forEach(r => {
    methodCounts[r.method] = (methodCounts[r.method] || 0) + 1;
    if (r.statusCode) {
      statusCounts[r.statusCode] = (statusCounts[r.statusCode] || 0) + 1;
    }
    formatCounts[r.format] = (formatCounts[r.format] || 0) + 1;
  });

  return {
    total: requests.length,
    methods: methodCounts,
    statusCodes: statusCounts,
    formats: formatCounts
  };
}

/**
 * Appends debug log entry to logs/incoming_requests.log
 */
function logDebugEvent(type, text, results) {
  const timestamp = new Date().toISOString();
  const entry = `\n================== [${timestamp}] ${type} ==================\n--- INCOMING RAW TEXT (${text.length} chars) ---\n${text}\n--- PARSED RESULTS (${results.length} items) ---\n${JSON.stringify(results, null, 2)}\n============================================================\n`;
  
  fs.appendFile(DEBUG_LOG_FILE, entry, (err) => {
    if (err) console.error('Failed to write debug log:', err);
  });
  console.log(`[${timestamp}] ${type}: Ingested ${text.length} chars -> Extracted ${results.length} requests`);
}

/**
 * Reads full request body buffer from stream.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parses multipart/form-data body to extract uploaded file contents.
 */
function extractMultipartFile(buffer, boundary) {
  const boundaryStr = `--${boundary}`;
  const raw = buffer.toString('binary');
  const parts = raw.split(boundaryStr);

  for (const part of parts) {
    if (part.includes('filename="')) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd !== -1) {
        const headerText = part.slice(0, headerEnd);
        const nameMatch = headerText.match(/filename="([^"]+)"/);
        const filename = nameMatch ? nameMatch[1] : 'uploaded_file.log';
        let bodyContent = part.slice(headerEnd + 4);
        if (bodyContent.endsWith('\r\n')) {
          bodyContent = bodyContent.slice(0, -2);
        }
        return { filename, content: Buffer.from(bodyContent, 'binary').toString('utf-8') };
      }
    }
  }
  return null;
}

export const server = http.createServer(async (req, res) => {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;

  try {
    // API: GET /api/health
    if (pathname === '/api/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: new Date() }));
    }

    // API: GET /api/samples
    if (pathname === '/api/samples' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(SAMPLE_LOGS));
    }

    // API: POST /api/parse
    if (pathname === '/api/parse' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Invalid JSON request body' }));
      }

      const { text, format = 'auto', baseUrl = '', multiline = true, maskHeaders = false, compressed = false, insecure = false, followRedirects = false } = payload;

      if (!text || typeof text !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Log text is required' }));
      }

      const parsedRaw = parseLogs(text, { format });
      const enriched = enrichRequests(parsedRaw, {
        baseUrl,
        multiline,
        maskHeaders,
        compressed,
        insecure,
        followRedirects
      });
      const summary = computeSummary(enriched);

      // Record debug event for watching
      logDebugEvent('POST /api/parse', text, enriched);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        count: enriched.length,
        requests: enriched,
        summary
      }));
    }

    // API: POST /api/upload
    if (pathname === '/api/upload' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      const rawBody = await readBody(req);

      let fileText = '';
      let filename = 'uploaded.log';

      if (contentType.includes('multipart/form-data')) {
        const match = contentType.match(/boundary=(.+)$/);
        if (match) {
          const boundary = match[1];
          const extracted = extractMultipartFile(rawBody, boundary);
          if (extracted) {
            fileText = extracted.content;
            filename = extracted.filename;
          }
        }
      } else {
        fileText = rawBody.toString('utf-8');
      }

      if (!fileText) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'No log file content received' }));
      }

      const parsedRaw = parseLogs(fileText, { format: 'auto' });
      const enriched = enrichRequests(parsedRaw, {});
      const summary = computeSummary(enriched);

      logDebugEvent(`POST /api/upload (${filename})`, fileText, enriched);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        filename,
        count: enriched.length,
        requests: enriched,
        summary
      }));
    }

    // API: POST /api/export
    if (pathname === '/api/export' && req.method === 'POST') {
      const rawBody = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(rawBody.toString('utf-8'));
      } catch {
        payload = {};
      }

      const { requests = [], multiline = false } = payload;
      let scriptContent = `#!/usr/bin/env bash\n# Generated by cURL Finder on ${new Date().toISOString()}\n# Total Requests: ${requests.length}\n\nset -e\n\n`;

      requests.forEach((reqItem, idx) => {
        const curl = multiline ? reqItem.multilineCurl || reqItem.curlCommand : reqItem.singlelineCurl || reqItem.curlCommand;
        scriptContent += `# [Request ${idx + 1}] ${reqItem.method} ${reqItem.url} (Line ${reqItem.lineNumber})\n`;
        scriptContent += `${curl}\n\necho ""\n\n`;
      });

      res.writeHead(200, {
        'Content-Type': 'application/x-sh',
        'Content-Disposition': 'attachment; filename="curl_requests.sh"'
      });
      return res.end(scriptContent);
    }

    // Static Files Handling from public/
    let safePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Access Denied');
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        const fallback = path.join(PUBLIC_DIR, 'index.html');
        fs.readFile(fallback, (fErr, content) => {
          if (fErr) {
            res.writeHead(404);
            return res.end('Not Found');
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
          res.end(content);
        });
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500);
          return res.end('Internal Server Error');
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
      });
    });

  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
});

export function startServer(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const actualPort = typeof address === 'object' ? address.port : port;
      console.log(`\n🚀 cURL Finder Server running at: http://localhost:${actualPort}`);
      console.log(`📁 Web UI ready at: http://localhost:${actualPort}\n`);
      console.log(`📝 Watching incoming logs in: ${DEBUG_LOG_FILE}\n`);
      resolve(server);
    });
  });
}

const isDirectCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectCli && process.env.NODE_ENV !== 'test') {
  startServer(PORT);
}

export default server;
