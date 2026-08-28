import { createParsedRequest } from './models.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

/**
 * Safely parses a JavaScript object literal or Python dict string (with single quotes, undefined, None, True, False).
 */
export function safeEvalObjectLiteral(text) {
  if (!text || typeof text !== 'string') return null;

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;

  let candidate = text.slice(firstBrace, lastBrace + 1).trim();

  // Try standard JSON.parse first
  try {
    return JSON.parse(candidate);
  } catch {}

  // Handle JS / Python syntax (None -> null, True -> true, False -> false)
  // Clean string representations:
  try {
    // Sanitize candidate to safely parse as JS expression
    // Replace Python constants if not in quotes
    const sanitized = candidate
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');

    // Safe evaluation using Function
    const fn = new Function(`"use strict"; return (${sanitized});`);
    const result = fn();
    if (result && typeof result === 'object') {
      return result;
    }
  } catch (err) {
    // If syntax error due to escaped quotes or template literals, try regex extraction
    return extractByRegexHeuristic(candidate);
  }

  return null;
}

/**
 * Heuristic regex extractor for objects with broken quotes or undefined properties.
 */
function extractByRegexHeuristic(text) {
  const urlMatch = text.match(/['"]?(?:url|api_name|endpoint|path)['"]?\s*:\s*['"](https?:\/\/[^'"]+|\/[^'"]+)['"]/i);
  if (!urlMatch) return null;

  const url = urlMatch[1];
  const methodMatch = text.match(/['"]?(?:method|httpMethod)['"]?\s*:\s*['"]([A-Za-z]+)['"]/i);
  const method = methodMatch ? methodMatch[1].toUpperCase() : (url.startsWith('http') || url.startsWith('/') ? 'GET' : null);

  if (!method) return null;

  // Extract headers
  const headers = {};
  const headersBlock = text.match(/['"]?headers['"]?\s*:\s*({[\s\S]*?})/i);
  if (headersBlock) {
    const pairRegex = /['"]?([a-zA-Z0-9_-]+)['"]?\s*:\s*['"]([^'"]*)['"]/g;
    let match;
    while ((match = pairRegex.exec(headersBlock[1])) !== null) {
      if (match[1] && match[2] && match[1] !== 'headers') {
        headers[match[1]] = match[2];
      }
    }
  }

  // Extract body/payload
  let body = null;
  const bodyMatch = text.match(/['"]?(?:body|data|payload|raw_request)['"]?\s*:\s*['"]?({[\s\S]*?}|\[[\s\S]*?\])['"]?/i);
  if (bodyMatch && bodyMatch[1] && bodyMatch[1] !== 'undefined') {
    body = bodyMatch[1];
  }

  return {
    url,
    method,
    headers,
    body
  };
}

/**
 * Parses a single-line or snippet containing a JS Object / Python Dict HTTP request.
 */
export function parseJsObjectLog(line, lineNumber = 1) {
  if (!line || typeof line !== 'string') return null;

  const obj = safeEvalObjectLiteral(line);
  if (!obj || typeof obj !== 'object') return null;

  // Unpack nested message if message is a stringified JS object
  let messageObj = null;
  if (typeof obj.message === 'string' && (obj.message.includes('{') || obj.message.includes('url') || obj.message.includes('api_name'))) {
    messageObj = safeEvalObjectLiteral(obj.message);
  }

  const reqObj = obj.data?.url ? obj.data : (messageObj?.url || messageObj?.api_name ? messageObj : (obj.req || obj.request || obj));

  let url = reqObj.url || reqObj.api_name || reqObj.endpoint || reqObj.path || reqObj.uri;
  let method = reqObj.method || reqObj.httpMethod || reqObj.requestMethod;

  // If api_name is e.g. "txl-account-service/v3/account/smartwallet/get-account-detail", and url is also present
  if (reqObj.api_name && reqObj.api_name.startsWith('http')) {
    url = reqObj.api_name;
  }

  if (!url || typeof url !== 'string') return null;

  // If method is missing, check event name or default to GET
  if (!method) {
    if (reqObj.body || reqObj.raw_request) {
      method = 'POST';
    } else {
      method = 'GET';
    }
  }

  method = String(method).trim().toUpperCase();
  if (!HTTP_METHODS.has(method)) {
    method = 'GET';
  }

  // Extract headers
  let headers = {};
  if (reqObj.headers && typeof reqObj.headers === 'object') {
    for (const [k, v] of Object.entries(reqObj.headers)) {
      if (v !== undefined && v !== null && !String(v).includes('${')) {
        headers[k] = String(v);
      }
    }
  }

  // Extract body
  let body = reqObj.body || reqObj.data || reqObj.payload || reqObj.raw_request || null;
  if (body === 'undefined' || body === undefined) {
    body = null;
  }

  const statusCode = reqObj.http_status_code || reqObj.statusCode || reqObj.status || obj.http_status_code || null;

  return createParsedRequest({
    method,
    url,
    headers,
    body,
    rawLog: line.trim(),
    lineNumber,
    format: 'JS/Python Object Log',
    statusCode: statusCode ? Number(statusCode) : null
  });
}
