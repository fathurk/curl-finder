/**
 * Calculates a composition / completeness score for an extracted HTTP request.
 * Higher score = more complete (has body, headers, authorization, full url, post/put method).
 */
export function calculateCompletenessScore({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  let score = 0;

  // 1. Body completeness (+50 for body, +15 for structured JSON)
  if (body !== null && body !== undefined) {
    const bodyStr = String(body).trim();
    if (bodyStr.length > 0) {
      score += 50;
      if (bodyStr.startsWith('{') || bodyStr.startsWith('[')) {
        score += 15;
      }
    }
  }

  // 2. Headers completeness (+5 per header, bonus for Authorization and Content-Type)
  const headerEntries = Object.entries(headers || {});
  score += headerEntries.length * 5;

  const lowerHeaderKeys = headerEntries.map(([k]) => k.toLowerCase());
  if (lowerHeaderKeys.includes('authorization') || lowerHeaderKeys.includes('xc-authorization')) {
    score += 20;
  }
  if (lowerHeaderKeys.includes('content-type')) {
    score += 10;
  }

  // 3. URL completeness (+25 for full http/https URL, +10 for relative path)
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    score += 25;
  } else if (url && url !== '/') {
    score += 10;
  }

  // 4. HTTP Method weight (POST/PUT/PATCH > DELETE > GET)
  const normMethod = (method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'PATCH'].includes(normMethod)) {
    score += 20;
  } else if (normMethod === 'DELETE') {
    score += 10;
  }

  return score;
}

/**
 * Creates a normalized HTTP request data object extracted from logs with completeness score.
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

  const normalizedUrl = (url || '/').trim();
  const completenessScore = calculateCompletenessScore({
    method: normalizedMethod,
    url: normalizedUrl,
    headers: normalizedHeaders,
    body: normalizedBody
  });

  return {
    id: id || `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    method: normalizedMethod,
    url: normalizedUrl,
    headers: normalizedHeaders,
    body: normalizedBody,
    completenessScore,
    rawLog: rawLog ? String(rawLog).trim() : '',
    lineNumber: Number(lineNumber) || 1,
    format,
    timestamp: timestamp || null,
    statusCode: statusCode ? Number(statusCode) : null,
    responseBody: responseBody || null,
    meta
  };
}
