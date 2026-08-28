import { createParsedRequest } from './models.js';

/**
 * Assembles and parses fragmented / multi-line / reverse-ordered cURL lines from log streams.
 *
 * @param {string|string[]} input - Array of lines or raw text
 * @param {number} [startLineNumber=1] - Starting line number
 * @returns {object|null} - Parsed request object or null
 */
export function parseFragmentedCurl(input, startLineNumber = 1) {
  const lines = Array.isArray(input) ? input : String(input).split(/\r?\n/);
  const cleanLines = lines.map(l => l.trim()).filter(Boolean);

  if (cleanLines.length === 0) return null;

  // Check if any line contains curl command fragments
  const hasCurl = cleanLines.some(l => /\bcurl\b/i.test(l));
  const hasHeader = cleanLines.some(l => /(?:-H|--header)\s+['"]/i.test(l));
  const hasData = cleanLines.some(l => /(?:-d|--data|--data-raw|--data-binary)\s+['"]/i.test(l));

  if (!hasCurl && !(hasHeader && hasData)) {
    return null;
  }

  // Check if lines are in reverse order (e.g. data at top, curl at bottom)
  let orderedLines = [...cleanLines];
  const curlIndex = orderedLines.findIndex(l => /\bcurl\b/i.test(l));

  if (curlIndex > 0 && curlIndex === orderedLines.length - 1) {
    // Curl is at the bottom -> Reverse the lines!
    orderedLines.reverse();
  }

  // Combine into single line, removing line-continuation backslashes
  const fullText = orderedLines.map(l => l.replace(/\\$/, '').trim()).join(' ');

  // Extract from the unified string
  return parseFullCurlCommand(fullText, startLineNumber);
}

/**
 * Extracts method, url, headers, and body from a full cURL command string.
 */
export function parseFullCurlCommand(curlStr, lineNumber = 1) {
  if (!curlStr || typeof curlStr !== 'string') return null;

  // Locate where "curl" starts (skip any user prompts like "generate curl from this")
  const curlIdx = curlStr.indexOf('curl ');
  let targetStr = curlIdx !== -1 ? curlStr.slice(curlIdx) : curlStr;

  let method = 'GET';
  let url = '';
  const headers = {};
  let body = null;

  // 1. Extract Method (-X POST, --request POST)
  const methodMatch = targetStr.match(/(?:-X|--request)\s+['"]?([A-Z]+)['"]?/i);
  if (methodMatch) {
    method = methodMatch[1].toUpperCase();
  }

  // 2. Extract Headers (-H 'Key: Value', --header "Key: Value")
  const headerRegex = /(?:-H|--header)\s+(?:'([^']*)'|"([^"]*)")/g;
  let hMatch;
  while ((hMatch = headerRegex.exec(targetStr)) !== null) {
    const rawHeader = hMatch[1] !== undefined ? hMatch[1] : hMatch[2];
    const colonIdx = rawHeader.indexOf(':');
    if (colonIdx !== -1) {
      const k = rawHeader.slice(0, colonIdx).trim();
      const v = rawHeader.slice(colonIdx + 1).trim();
      headers[k] = v;
    }
  }

  // 3. Extract Body (-d '...', --data-raw '...', --data-binary '...')
  const bodyRegex = /(?:-d|--data|--data-raw|--data-binary)\s+(?:'([\s\S]*?)'(?:\s|$)|"([\s\S]*?)"(?:\s|$))/;
  const bodyMatch = targetStr.match(bodyRegex);
  if (bodyMatch) {
    let rawBody = bodyMatch[1] !== undefined ? bodyMatch[1] : bodyMatch[2];
    // Handle escaped quotes in body
    if (rawBody.includes('\\"')) {
      try {
        const unescaped = rawBody.replace(/\\"/g, '"');
        rawBody = unescaped;
      } catch {}
    }
    body = rawBody;
    if (method === 'GET' && !methodMatch) {
      method = 'POST'; // Default to POST when body is present
    }
  }

  // 4. Extract URL
  const urlRegex = /(?:curl\s+(?:-[A-Za-z0-9_-]+\s*(?:'[^']*'|"[^"]*"|\S*)\s+)*)?['"]?(https?:\/\/[^\s'"]+|\/[^\s'"]+)['"]?/;
  // More specific URL search: look for http:// or https:// or relative /path
  const urlDirectMatch = targetStr.match(/['"]?(https?:\/\/[^\s'"\\]+)['"]?/) || targetStr.match(/(?:'|")(\/[a-zA-Z0-9_\-\/?.&=%#]+)(?:'|")/);
  if (urlDirectMatch) {
    url = urlDirectMatch[1];
  } else {
    // Fallback token extraction
    const tokens = targetStr.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i].replace(/^['"]|['"]$/g, '');
      if (
        (t.startsWith('http://') || t.startsWith('https://') || t.startsWith('/')) &&
        tokens[i - 1] !== '-H' &&
        tokens[i - 1] !== '--header' &&
        tokens[i - 1] !== '-d' &&
        tokens[i - 1] !== '--data-raw' &&
        tokens[i - 1] !== '-X'
      ) {
        url = t;
        break;
      }
    }
  }

  if (!url) {
    // If no explicit URL was found in curlStr, but we have body/headers
    if (!body && Object.keys(headers).length === 0) return null;
    url = '/';
  }

  return createParsedRequest({
    method,
    url,
    headers,
    body,
    rawLog: curlStr.trim(),
    lineNumber,
    format: 'Extracted cURL'
  });
}
