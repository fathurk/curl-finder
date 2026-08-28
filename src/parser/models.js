/**
 * Creates a normalized HTTP request data object extracted from logs.
 */
export function createParsedRequest({
  id = null,
  method = 'GET',
  url = '/',
  headers = {},
  body = null,
  rawLog = '',
  lineNumber = 1,
  format = 'unknown',
  timestamp = null,
  statusCode = null,
  responseBody = null,
  meta = {}
} = {}) {
  const normalizedMethod = (method || 'GET').trim().toUpperCase();
  
  // Clean headers: ensure object with string keys and string values
  const normalizedHeaders = {};
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    for (const [key, val] of Object.entries(headers)) {
      if (val !== undefined && val !== null) {
        normalizedHeaders[key.trim()] = typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    }
  }

  // Format body
  let normalizedBody = body;
  if (normalizedBody !== null && normalizedBody !== undefined) {
    if (typeof normalizedBody === 'object') {
      try {
        normalizedBody = JSON.stringify(normalizedBody, null, 2);
      } catch {
        normalizedBody = String(normalizedBody);
      }
    } else {
      normalizedBody = String(normalizedBody);
    }
  } else {
    normalizedBody = null;
  }

  return {
    id: id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    method: normalizedMethod,
    url: (url || '/').trim(),
    headers: normalizedHeaders,
    body: normalizedBody,
    rawLog: rawLog ? String(rawLog).trim() : '',
    lineNumber: Number(lineNumber) || 1,
    format,
    timestamp: timestamp || null,
    statusCode: statusCode ? Number(statusCode) : null,
    responseBody: responseBody || null,
    meta
  };
}
