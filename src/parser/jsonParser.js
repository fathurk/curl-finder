import { createParsedRequest } from './models.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

/**
 * Checks if a string or object has JSON HTTP request structure and extracts it.
 */
export function parseJsonLog(input, lineNumber = 1) {
  const requests = [];

  let obj = null;
  if (typeof input === 'object' && input !== null) {
    obj = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    // 1. Direct JSON parse
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        obj = JSON.parse(trimmed);
      } catch {
        obj = extractEmbeddedJson(trimmed);
      }
    } else {
      obj = extractEmbeddedJson(trimmed);
    }
  }

  if (!obj) return requests;

  // Check if this is a HAR (HTTP Archive) file
  if (obj.log && Array.isArray(obj.log.entries)) {
    obj.log.entries.forEach((entry, idx) => {
      if (entry.request) {
        const parsedHar = extractFromHarRequest(entry.request, lineNumber + idx);
        if (parsedHar) requests.push(parsedHar);
      }
    });
    return requests;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      const parsed = extractFromJsonObject(item, lineNumber + idx, typeof input === 'string' ? input : JSON.stringify(item));
      if (parsed) requests.push(parsed);
    });
  } else {
    const parsed = extractFromJsonObject(obj, lineNumber, typeof input === 'string' ? input : JSON.stringify(obj));
    if (parsed) requests.push(parsed);
  }

  return requests;
}

/**
 * Searches for all balanced JSON objects inside a text chunk.
 */
export function extractAllJsonObjects(text) {
  const objects = [];
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        if (braceCount === 0) {
          startIndex = i;
        }
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          const candidate = text.slice(startIndex, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            objects.push({ parsed, raw: candidate, index: startIndex });
          } catch {
            // ignore invalid json candidate
          }
          startIndex = -1;
        }
      }
    }
  }

  return objects;
}

/**
 * Searches for a balanced JSON substring inside a log line.
 */
function extractEmbeddedJson(text) {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Analyzes a JSON object to extract HTTP request parameters.
 */
export function extractFromJsonObject(json, lineNumber, rawLog) {
  if (!json || typeof json !== 'object') return null;

  // Check if stringified JSON is hidden inside a 'message' or 'msg' field
  if (typeof json.message === 'string' && json.message.trim().startsWith('{')) {
    try {
      const nestedMsg = JSON.parse(json.message);
      const parsedNested = extractFromJsonObject(nestedMsg, lineNumber, rawLog);
      if (parsedNested) return parsedNested;
    } catch {}
  }
  if (typeof json.msg === 'string' && json.msg.trim().startsWith('{')) {
    try {
      const nestedMsg = JSON.parse(json.msg);
      const parsedNested = extractFromJsonObject(nestedMsg, lineNumber, rawLog);
      if (parsedNested) return parsedNested;
    } catch {}
  }

  // Check common nested request locations: req, request, httpRequest, http, event, data, context
  const reqObj = json.req || json.request || json.httpRequest || json.http ||
                 (json.event?.httpMethod ? json.event : null) ||
                 (json.data?.method ? json.data : null) ||
                 (json.context?.method ? json.context : null) ||
                 json;

  let method = reqObj.method || reqObj.httpMethod || reqObj.requestMethod || json.method || json.httpMethod;
  let url = reqObj.url || reqObj.originalUrl || reqObj.requestUrl || reqObj.uri || reqObj.path || reqObj.pathname || reqObj.endpoint || reqObj.route ||
            json.url || json.originalUrl || json.requestUrl || json.uri || json.path || json.pathname || json.endpoint || json.route;

  if (!method && !url) {
    return null;
  }

  // Handle case where method is missing but url exists
  if (!method && url && typeof url === 'string') {
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('/')) {
      method = 'GET';
    } else {
      return null;
    }
  }

  method = String(method).trim().toUpperCase();
  if (!HTTP_METHODS.has(method)) {
    const methodParts = method.split(/\s+/);
    if (methodParts.length >= 2 && HTTP_METHODS.has(methodParts[0])) {
      method = methodParts[0];
      if (!url || url === '/') {
        url = methodParts[1];
      }
    } else {
      return null;
    }
  }

  // Query parameters: check if queryStringParameters or query is present
  const query = reqObj.queryStringParameters || reqObj.query || json.queryStringParameters || json.query;
  if (query && typeof query === 'object' && typeof url === 'string' && !url.includes('?')) {
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) {
        searchParams.append(k, String(v));
      }
    }
    const qStr = searchParams.toString();
    if (qStr) {
      url += (url.includes('?') ? '&' : '?') + qStr;
    }
  }

  // Headers: normalize object or array (like rawHeaders / ASGI format)
  let rawHeaders = reqObj.headers || reqObj.header || reqObj.rawHeaders || json.headers || json.header || {};
  let headers = {};

  if (Array.isArray(rawHeaders)) {
    // Array format: ['Header-1', 'val-1', 'Header-2', 'val-2'] or [['name', 'val'], ...]
    if (rawHeaders.length > 0 && Array.isArray(rawHeaders[0])) {
      for (const [k, v] of rawHeaders) {
        if (k) headers[String(k)] = String(v);
      }
    } else {
      for (let i = 0; i < rawHeaders.length; i += 2) {
        if (rawHeaders[i]) {
          headers[String(rawHeaders[i])] = String(rawHeaders[i + 1] || '');
        }
      }
    }
  } else if (typeof rawHeaders === 'object' && rawHeaders !== null) {
    headers = rawHeaders;
  }

  // Body / Payload / Parameters
  let body = reqObj.body || reqObj.data || reqObj.payload || reqObj.params || reqObj.requestBody || reqObj.parameters ||
             json.body || json.data || json.payload || json.requestBody || json.parameters || null;

  // Timestamp
  const timestamp = json.timestamp || json.time || json['@timestamp'] || json.date || reqObj.timestamp || null;

  // Status code
  const statusCode = json.statusCode || json.status || reqObj.statusCode || reqObj.status || json.res?.statusCode || null;

  // If host is in headers and URL is relative, attach host
  let fullUrl = String(url || '/');
  if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
    const hostHeader = headers['host'] || headers['Host'] || reqObj.hostname || json.hostname;
    if (hostHeader) {
      const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
      fullUrl = `${proto}://${hostHeader}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
    }
  }

  return createParsedRequest({
    method,
    url: fullUrl,
    headers,
    body,
    rawLog: rawLog || JSON.stringify(json),
    lineNumber,
    format: 'JSON / Structured Log',
    timestamp: timestamp ? String(timestamp) : null,
    statusCode: statusCode ? Number(statusCode) : null,
    meta: { rawObject: json }
  });
}

/**
 * Extracts a request from a HAR 1.2 request entry object.
 */
function extractFromHarRequest(req, lineNumber) {
  if (!req || !req.method || !req.url) return null;

  const headers = {};
  if (Array.isArray(req.headers)) {
    req.headers.forEach(h => {
      if (h.name && !h.name.startsWith(':')) {
        headers[h.name] = h.value;
      }
    });
  }

  let body = null;
  if (req.postData && req.postData.text) {
    body = req.postData.text;
  }

  return createParsedRequest({
    method: req.method.toUpperCase(),
    url: req.url,
    headers,
    body,
    rawLog: `HAR Entry: ${req.method} ${req.url}`,
    lineNumber,
    format: 'HAR (DevTools Network Log)'
  });
}
