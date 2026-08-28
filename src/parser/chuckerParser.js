import { createParsedRequest } from './models.js';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

/**
 * Checks if the text contains a Chucker / Chuck Android HTTP inspector log dump.
 */
export function isChuckerLog(text) {
  if (!text || typeof text !== 'string') return false;
  return /URL:\s*https?:\/\//i.test(text) || 
         (text.includes('---------- Request ----------') && /Method:\s*[A-Z]+/i.test(text));
}

/**
 * Parses Chucker Android HTTP inspector logs (single or multiple transactions).
 *
 * @param {string} text - Full text containing Chucker log(s)
 * @param {number} [startLine=1]
 * @returns {Array<object>} Array of parsed request objects
 */
export function parseChuckerLogs(text, startLine = 1) {
  if (!text || typeof text !== 'string') return [];

  // Split multi-transaction Chucker exports by "URL:" delimiter
  const transactionBlocks = text.split(/(?=^URL:\s*https?:\/\/)/mi).map(b => b.trim()).filter(Boolean);

  const results = [];
  let currentLineOffset = startLine;

  for (const block of transactionBlocks) {
    const parsed = parseSingleChuckerTransaction(block, currentLineOffset);
    if (parsed) {
      results.push(parsed);
    }
    currentLineOffset += block.split(/\r?\n/).length;
  }

  return results;
}

/**
 * Parses a single Chucker transaction block.
 */
function parseSingleChuckerTransaction(block, lineNumber = 1) {
  const lines = block.split(/\r?\n/);
  
  let url = null;
  let method = 'GET';
  let statusCode = null;
  let timestamp = null;

  let inRequestSection = false;
  let inResponseSection = false;

  const requestHeaderLines = [];
  const requestBodyLines = [];
  let inRequestBody = false;

  const responseBodyLines = [];
  let inResponseBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Section dividers
    if (/^----------\s*Request\s*----------/i.test(trimmed)) {
      inRequestSection = true;
      inResponseSection = false;
      inRequestBody = false;
      continue;
    }
    if (/^----------\s*Response\s*----------/i.test(trimmed)) {
      inRequestSection = false;
      inResponseSection = true;
      inResponseBody = false;
      continue;
    }

    // Top metadata (before Request section)
    if (!inRequestSection && !inResponseSection) {
      const urlMatch = line.match(/^URL:\s*(.+)$/i);
      if (urlMatch) {
        url = urlMatch[1].trim();
        continue;
      }

      const methodMatch = line.match(/^Method:\s*([A-Za-z]+)$/i);
      if (methodMatch) {
        const m = methodMatch[1].trim().toUpperCase();
        if (HTTP_METHODS.has(m)) method = m;
        continue;
      }

      const statusMatch = line.match(/^Response:\s*(\d+)/i);
      if (statusMatch) {
        statusCode = parseInt(statusMatch[1], 10);
        continue;
      }

      const timeMatch = line.match(/^Request time:\s*(.+)$/i);
      if (timeMatch) {
        timestamp = timeMatch[1].trim();
        continue;
      }
    }

    // Request section processing
    if (inRequestSection) {
      if (!inRequestBody) {
        if (trimmed === '' && requestHeaderLines.length > 0) {
          // Empty line marks transition from headers to body
          inRequestBody = true;
          continue;
        }

        const headerMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (headerMatch && !/^\(body is empty\)$/i.test(trimmed)) {
          requestHeaderLines.push({ key: headerMatch[1].trim(), value: headerMatch[2].trim() });
        } else if (trimmed && !/^\(body is empty\)$/i.test(trimmed)) {
          // No header colon found -> body started
          inRequestBody = true;
          requestBodyLines.push(line);
        }
      } else {
        if (!/^\(body is empty\)$/i.test(trimmed)) {
          requestBodyLines.push(line);
        }
      }
    }

    // Response section processing (optional)
    if (inResponseSection) {
      if (!inResponseBody) {
        if (trimmed === '' && lines[i - 1]?.includes(':')) {
          inResponseBody = true;
          continue;
        }
      } else {
        responseBodyLines.push(line);
      }
    }
  }

  if (!url) return null;

  // Build headers object
  const headers = {};
  for (const { key, value } of requestHeaderLines) {
    // Avoid Chucker metadata strings
    if (['request', 'response', 'url', 'method'].includes(key.toLowerCase())) continue;
    headers[key] = value;
  }

  // Build body
  let body = null;
  const rawBodyText = requestBodyLines.join('\n').trim();
  if (rawBodyText && rawBodyText !== '(body is empty)') {
    body = rawBodyText;
  }

  const responseBody = responseBodyLines.length > 0 ? responseBodyLines.join('\n').trim() : null;

  return createParsedRequest({
    method,
    url,
    headers,
    body,
    rawLog: block.slice(0, 500) + (block.length > 500 ? '...' : ''),
    lineNumber,
    format: 'Chucker HTTP Log',
    timestamp,
    statusCode,
    responseBody
  });
}
