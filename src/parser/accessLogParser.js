import { createParsedRequest } from './models.js';

// Regex for Combined/Common Log Format:
// e.g.: 127.0.0.1 - user [28/Aug/2026:12:00:00 +0000] "POST /api/v1/checkout HTTP/1.1" 200 512 "https://example.com" "Mozilla/5.0..."
const CLF_REGEX = /^(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s"]+)(?:\s+HTTP\/[0-9.]+)?(?:")\s+(\d{3})\s+(\S+)(?:\s+"([^"]*)"\s+"([^"]*)")?/;

// Regex for simpler quoted HTTP request line:
// e.g.: ... "GET /api/v1/users?page=2 HTTP/1.1" 200 ...
const QUOTED_REQUEST_REGEX = /"([A-Z]+)\s+([^\s"]+)(?:\s+HTTP\/[0-9.]+)?(?:")\s+(\d{3})?/;

// Regex for Envoy / Ingress format with bracketed timestamp:
const ENVOY_PREFIX_REGEX = /^\[([^\]]+)\]\s+"([A-Z]+)\s+([^\s"]+)(?:\s+HTTP\/[0-9.]+)?(?:")\s+(\d{3})/;

/**
 * Parses access logs from web servers (Nginx, Apache, Envoy, Traefik, etc.)
 */
export function parseAccessLog(line, lineNumber = 1) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();

  // 1. Try standard Combined/Common log format first
  const clfMatch = trimmed.match(CLF_REGEX);
  if (clfMatch) {
    const [, ip, , , timestamp, method, path, statusCode, , referer, userAgent] = clfMatch;
    const headers = {};
    if (userAgent && userAgent !== '-') headers['User-Agent'] = userAgent;
    if (referer && referer !== '-') headers['Referer'] = referer;
    if (ip && ip !== '-') headers['X-Forwarded-For'] = ip;

    return createParsedRequest({
      method,
      url: path,
      headers,
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Access Log (Nginx/Apache)',
      timestamp,
      statusCode: statusCode ? Number(statusCode) : null
    });
  }

  // 2. Try Envoy / Ingress access log
  const envoyPrefixMatch = trimmed.match(ENVOY_PREFIX_REGEX);
  if (envoyPrefixMatch) {
    const [, timestamp, method, path, statusCode] = envoyPrefixMatch;
    
    // Extract all subsequent quoted fields
    const afterReq = trimmed.slice(envoyPrefixMatch[0].length);
    const quotesMatches = [...afterReq.matchAll(/"([^"]*)"/g)].map(m => m[1]);

    const headers = {};
    for (const q of quotesMatches) {
      if (!q || q === '-') continue;
      if (q.startsWith('Mozilla/') || q.startsWith('curl/') || q.startsWith('Postman') || q.includes('WebKit')) {
        headers['User-Agent'] = q;
      } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q) || q.startsWith('req-')) {
        headers['X-Request-Id'] = q;
      } else if (q.includes('.') || q.includes(':')) {
        // Domain / Host authority (e.g. api.shop.com)
        if (!headers['Host']) {
          headers['Host'] = q;
        }
      }
    }

    return createParsedRequest({
      method,
      url: path,
      headers,
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Access Log (Envoy/Ingress)',
      timestamp,
      statusCode: statusCode ? Number(statusCode) : null
    });
  }

  // 3. Generic quoted request inside the line e.g. ... "POST /path HTTP/1.1" 200 ...
  const quotedMatch = trimmed.match(QUOTED_REQUEST_REGEX);
  if (quotedMatch) {
    const [, method, path, statusCode] = quotedMatch;
    return createParsedRequest({
      method,
      url: path,
      headers: {},
      body: null,
      rawLog: trimmed,
      lineNumber,
      format: 'Access Log (Generic)',
      statusCode: statusCode ? Number(statusCode) : null
    });
  }

  return null;
}
