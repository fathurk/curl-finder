import { createParsedRequest } from './models.js';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
const REQUEST_LINE_REGEX = new RegExp(`^(${HTTP_METHODS.join('|')})\\s+(\\S+)(?:\\s+HTTP\\/[0-9.]+)?$`, 'i');

/**
 * Parses raw HTTP wire requests (headers block + body).
 */
export function parseRawHttpRequest(text, startLineNumber = 1) {
  if (!text || typeof text !== 'string') return null;

  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return null;

  // Find the first line that matches HTTP request line
  let reqLineIndex = -1;
  let method = '';
  let path = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(REQUEST_LINE_REGEX);
    if (match) {
      reqLineIndex = i;
      method = match[1].toUpperCase();
      path = match[2];
      break;
    }
  }

  if (reqLineIndex === -1) return null;

  const headers = {};
  let bodyStartIndex = -1;

  for (let i = reqLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Empty line indicates end of headers and start of body
    if (line.trim() === '') {
      bodyStartIndex = i + 1;
      break;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }
  }

  let body = null;
  if (bodyStartIndex !== -1 && bodyStartIndex < lines.length) {
    const rawBody = lines.slice(bodyStartIndex).join('\n').trim();
    if (rawBody.length > 0) {
      body = rawBody;
    }
  }

  // If Host header is present and path is relative, we can build the full URL
  let fullUrl = path;
  if (headers['Host'] || headers['host']) {
    const host = headers['Host'] || headers['host'];
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
      const proto = headers['X-Forwarded-Proto'] || 'https';
      fullUrl = `${proto}://${host}${fullUrl.startsWith('/') ? '' : '/'}${fullUrl}`;
    }
  }

  return createParsedRequest({
    method,
    url: fullUrl,
    headers,
    body,
    rawLog: text.trim(),
    lineNumber: startLineNumber + reqLineIndex,
    format: 'Raw HTTP Request'
  });
}
