import { createParsedRequest } from './models.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const HTTP_METHODS_PATTERN = HTTP_METHODS.join('|');

/**
 * Parses client/server debug logs, logfmt key-value lines, framework logs, and embedded curl commands.
 */
export function parseDebugLog(line, lineNumber = 1) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();

  // 1. Embedded cURL command in log
  if (trimmed.includes('curl ') || trimmed.startsWith('curl')) {
    const curlReq = parseEmbeddedCurl(trimmed, lineNumber);
    if (curlReq) return curlReq;
  }

  // 2. Logfmt key-value pair format e.g. method=POST path=/items host=example.com status=200
  const logfmtReq = parseLogfmt(trimmed, lineNumber);
  if (logfmtReq) return logfmtReq;

  // 3. Morgan / Express dev logger format:
  // e.g. "GET /api/v1/users 200 4.123 ms - 128"
  // e.g. "POST /api/v1/checkout 201 12.3 ms - 512"
  const morganMatch = trimmed.match(new RegExp(`^(${HTTP_METHODS_PATTERN})\\s+(\\S+)\\s+(\\d{3})\\s+[0-9.]+\\s*ms`, 'i'));
  if (morganMatch) {
    const [, method, path, statusCode] = morganMatch;
    return createParsedRequest({
      method: method.toUpperCase(),
      url: path,
      headers: {},
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Morgan / Express Logger',
      statusCode: Number(statusCode)
    });
  }

  // 4. Gin / Fiber / Go framework logs:
  // e.g. "[GIN] 2026/08/28 - 18:00:00 | 200 | 1.2ms | 127.0.0.1 | POST \"/api/v1/auth\""
  // e.g. "[FIBER] 200 - 12ms 127.0.0.1 POST /api/v1/auth"
  const ginMatch = trimmed.match(new RegExp(`\\[(?:GIN|FIBER|ECHO|CHI)\\][\\s\\S]*?\\|?\\s*(\\d{3})?\\s*\\|?[\\s\\S]*?\\b(${HTTP_METHODS_PATTERN})\\s+["']?([^"\\s]+)["']?`, 'i'));
  if (ginMatch) {
    const [, statusCode, method, path] = ginMatch;
    return createParsedRequest({
      method: method.toUpperCase(),
      url: path,
      headers: {},
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Go Framework (Gin/Fiber/Echo)',
      statusCode: statusCode ? Number(statusCode) : null
    });
  }

  // 5. FastAPI / Uvicorn / Gunicorn / Flask logs:
  // e.g. "INFO:     127.0.0.1:51234 - \"POST /api/v1/items HTTP/1.1\" 200 OK"
  // e.g. "INFO: 127.0.0.1 - - [28/Aug/2026] \"GET /docs HTTP/1.1\" 200 -"
  const uvicornMatch = trimmed.match(new RegExp(`(?:INFO|DEBUG|WARNING|ERROR)?:?\\s*\\S+:\\d*\\s*-\\s*"(${HTTP_METHODS_PATTERN})\\s+([^"\\s]+)(?:\\s+HTTP\\/[0-9.]+)?(?:")\\s+(\\d{3})?`, 'i'));
  if (uvicornMatch) {
    const [, method, path, statusCode] = uvicornMatch;
    return createParsedRequest({
      method: method.toUpperCase(),
      url: path,
      headers: {},
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Python (Uvicorn/FastAPI/Flask)',
      statusCode: statusCode ? Number(statusCode) : null
    });
  }

  // 6. Spring Boot / Rails / NestJS logs:
  // e.g. "Started POST \"/users\" for 127.0.0.1 at 2026-08-28 ..."
  // e.g. "Completed 200 OK for POST \"/api/v1/items\""
  // e.g. "[Nest] 12345  - 08/28/2026, 6:00:00 PM     LOG [RouterExplorer] Mapped {/api/v1/users, POST} route"
  const springMatch = trimmed.match(new RegExp(`(?:Completed|Mapped|Started|Handling|Route)\\s+.*?(${HTTP_METHODS_PATTERN})\\s+["']?([^"\\s,}]+)["']?`, 'i'));
  if (springMatch) {
    const [, method, path] = springMatch;
    const statusInLine = trimmed.match(/\b(\d{3})\s+(?:OK|Created|Accepted|No Content|Found|Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error)\b/i);
    return createParsedRequest({
      method: method.toUpperCase(),
      url: path,
      headers: {},
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Framework (Spring/Rails/NestJS)',
      statusCode: statusInLine ? Number(statusInLine[1]) : null
    });
  }

  // 7. Axios / Fetch / OkHttp / Http debug patterns:
  // e.g. "[Axios] Request: POST https://api.example.com/users ..."
  // e.g. "--> POST https://api.example.com/users"
  const debugMatch = trimmed.match(new RegExp(`(?:Request|HTTP|API|Started|Incoming|-->)?\\s*(${HTTP_METHODS_PATTERN})\\s+(https?://\\S+|/[^\\s"']+)`, 'i'));
  if (debugMatch) {
    const [, method, url] = debugMatch;
    
    // Extract headers if present in format Headers: {...} or Headers: {key: val}
    const headers = {};
    const headersMatch = trimmed.match(/Headers:\s*({.+?})/i) || trimmed.match(/Headers:\s*(\[[^\]]+\])/i);
    if (headersMatch) {
      try {
        const parsedHeaders = JSON.parse(headersMatch[1]);
        Object.assign(headers, parsedHeaders);
      } catch {
        const headerPairs = headersMatch[1].replace(/[{}]/g, '').split(',');
        for (const pair of headerPairs) {
          const [k, v] = pair.split(/[:=]/);
          if (k && v) headers[k.trim().replace(/['"]/g, '')] = v.trim().replace(/['"]/g, '');
        }
      }
    }

    // Extract body if present in format Data: {...} or Body: {...} or Payload: {...}
    let body = null;
    const bodyMatch = trimmed.match(/(?:Data|Body|Payload|Parameters):\s*({.+}|\[.+\]|"[^"]+"|\S+)/i);
    if (bodyMatch) {
      body = bodyMatch[1].trim();
      try {
        const parsed = JSON.parse(body);
        body = JSON.stringify(parsed, null, 2);
      } catch {}
    }

    return createParsedRequest({
      method: method.toUpperCase(),
      url,
      headers,
      body,
      rawLog: trimmed,
      lineNumber,
      format: 'Debug / Client Log'
    });
  }

  return null;
}

/**
 * Parses key-value formatted logfmt lines.
 */
function parseLogfmt(line, lineNumber) {
  const methodMatch = line.match(/(?:method|http_method)=["']?([A-Za-z]+)["']?/i);
  const urlMatch = line.match(/(?:url|path|uri|request_uri)=["']?([^"'\s]+)["']?/i);

  if (!methodMatch || !urlMatch) return null;

  const method = methodMatch[1].toUpperCase();
  if (!HTTP_METHODS.includes(method)) return null;

  let url = urlMatch[1];
  const hostMatch = line.match(/(?:host|domain)=["']?([^"'\s]+)["']?/i);
  if (hostMatch && !url.startsWith('http://') && !url.startsWith('https://')) {
    const host = hostMatch[1];
    url = (host.startsWith('http') ? host : `https://${host}`) + (url.startsWith('/') ? '' : '/') + url;
  }

  let body = null;
  const bodyMatch = line.match(/(?:body|payload|data)=["']({.+?}|\[.+?\]|[^"'\s]+)["']?/i);
  if (bodyMatch) {
    body = bodyMatch[1];
  }

  const statusMatch = line.match(/(?:status|status_code)=["']?(\d{3})["']?/i);

  return createParsedRequest({
    method,
    url,
    headers: {},
    body,
    rawLog: line,
    lineNumber,
    format: 'Logfmt (Key-Value)',
    statusCode: statusMatch ? Number(statusMatch[1]) : null
  });
}

/**
 * Parses an already existing curl command line (including multiline).
 */
export function parseEmbeddedCurl(rawText, lineNumber = 1) {
  // Normalize multi-line backslashes
  const normalized = rawText.replace(/\\\r?\n\s*/g, ' ').trim();
  const curlIndex = normalized.indexOf('curl ');
  const curlStr = curlIndex !== -1 ? normalized.slice(curlIndex) : normalized;

  let method = 'GET';
  let url = '/';
  const headers = {};
  let body = null;

  // Extract method (-X POST / --request POST)
  const methodMatch = curlStr.match(/(?:-X|--request)\s+['"]?([A-Z]+)['"]?/i);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  // Extract headers (-H '...' / --header '...')
  const headerRegex = /(?:-H|--header)\s+['"]([^'"]+)['"]/g;
  let hMatch;
  while ((hMatch = headerRegex.exec(curlStr)) !== null) {
    const colonIdx = hMatch[1].indexOf(':');
    if (colonIdx !== -1) {
      const k = hMatch[1].slice(0, colonIdx).trim();
      const v = hMatch[1].slice(colonIdx + 1).trim();
      headers[k] = v;
    }
  }

  // Extract body (-d '...' / --data '...' / --data-raw '...' / --data-binary '...')
  const dataMatch = curlStr.match(/(?:-d|--data|--data-raw|--data-binary)\s+['"]([\s\S]*?)['"](?:\s|$)/);
  if (dataMatch) {
    body = dataMatch[1];
    if (method === 'GET' && !methodMatch) {
      method = 'POST';
    }
  }

  // Extract URL (first token not starting with - after curl)
  const tokens = curlStr.split(/\s+/);
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i].replace(/^['"]|['"]$/g, '');
    const prev = tokens[i - 1];
    if (
      !token.startsWith('-') &&
      prev !== '-X' &&
      prev !== '--request' &&
      prev !== '-H' &&
      prev !== '--header' &&
      prev !== '-d' &&
      prev !== '--data' &&
      prev !== '--data-raw' &&
      prev !== '--data-binary' &&
      prev !== '-u' &&
      prev !== '--user' &&
      (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('/') || token.includes('.'))
    ) {
      url = token;
      break;
    }
  }

  return createParsedRequest({
    method,
    url,
    headers,
    body,
    rawLog: rawText.trim(),
    lineNumber,
    format: 'Embedded cURL'
  });
}
