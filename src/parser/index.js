import { parseJsonLog, extractFromJsonObject } from './jsonParser.js';
import { parseAccessLog } from './accessLogParser.js';
import { parseDebugLog, parseEmbeddedCurl } from './debugLogParser.js';
import { parseRawHttpRequest } from './rawHttpParser.js';
import { unwrapContainerLogs } from './containerUnwrapper.js';
import { parseFragmentedCurl } from './curlAssembler.js';
import { parseJsObjectLog } from './jsObjectParser.js';
import { isChuckerLog, parseChuckerLogs } from './chuckerParser.js';

/**
 * Strips ANSI color escape sequences from terminal logs.
 */
function stripAnsi(str) {
  if (!str) return '';
  return str.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

/**
 * Main parser coordinator that ingests raw log text and returns an array of parsed HTTP requests.
 *
 * @param {string} rawText - The log content (text, file contents)
 * @param {object} [options] - Options such as forced format or baseUrl
 * @returns {Array<object>} - Array of parsed request objects
 */
export function parseLogs(rawText, options = {}) {
  if (!rawText || typeof rawText !== 'string') return [];

  // Clean ANSI terminal colors
  const clean = stripAnsi(rawText);
  const text = clean.trim();
  if (!text) return [];

  const { format = 'auto' } = options;

  // 1. Explicit format handlers
  if (format === 'json') {
    return parseJsonLog(text, 1);
  }
  if (format === 'raw-http') {
    const res = parseRawHttpRequest(text, 1);
    return res ? [res] : [];
  }
  if (format === 'access-log') {
    const lines = text.split(/\r?\n/);
    return lines.map((l, i) => parseAccessLog(l, i + 1)).filter(Boolean);
  }
  if (format === 'chucker') {
    return parseChuckerLogs(text, 1);
  }

  // 2. CONTAINER LOG UNWRAPPING (TKE __CONTENT__, Docker, K8s, CloudWatch)
  const unwrapped = unwrapContainerLogs(text);
  const targetText = unwrapped.isWrapped ? unwrapped.unwrappedText : text;
  const workingLines = unwrapped.isWrapped ? unwrapped.lines : targetText.split(/\r?\n/);

  // 3. CHECK FOR CHUCKER ANDROID HTTP INSPECTOR LOGS
  if (isChuckerLog(targetText)) {
    const chuckerReqs = parseChuckerLogs(targetText, 1);
    if (chuckerReqs.length > 0) {
      return chuckerReqs;
    }
  }

  // 4. CHECK FOR FRAGMENTED / MULTI-LINE / REVERSE-ORDERED cURL COMMANDS
  const fragmentedCurl = parseFragmentedCurl(workingLines, 1);
  if (fragmentedCurl && (fragmentedCurl.url !== '/' || fragmentedCurl.body || Object.keys(fragmentedCurl.headers).length > 0)) {
    return [fragmentedCurl];
  }

  // 4. AUTO-DETECT STRATEGY
  // 4a. Check if targetText is a single valid JSON payload (Object, Array, or HAR)
  if ((targetText.startsWith('{') && targetText.endsWith('}')) || (targetText.startsWith('[') && targetText.endsWith(']'))) {
    try {
      const parsedJson = JSON.parse(targetText);
      const jsonReqs = parseJsonLog(parsedJson, 1);
      if (jsonReqs.length > 0) {
        return jsonReqs;
      }
    } catch {
      // Continue
    }
  }

  // 4b. Check if targetText is a single multi-line cURL command
  if (/^\s*curl\s+/i.test(targetText) && targetText.includes('\\')) {
    const embedded = parseEmbeddedCurl(targetText, 1);
    if (embedded) return [embedded];
  }

  // 4c. Check if targetText looks like a single Raw HTTP request
  const firstLine = targetText.split(/\r?\n/)[0].trim();
  if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+\s+HTTP\/[0-9.]+/i.test(firstLine)) {
    const rawHttpReq = parseRawHttpRequest(targetText, 1);
    if (rawHttpReq && Object.keys(rawHttpReq.headers).length > 0) {
      return [rawHttpReq];
    }
  }

  // 5. Process line-by-line / block-by-block for stream logs
  const results = [];
  let inRawHttpBlock = false;
  let rawHttpBuffer = [];
  let rawHttpStartLine = 1;

  let inJsonBlock = false;
  let jsonBuffer = [];
  let jsonBraceCount = 0;
  let jsonStartLine = 1;

  for (let i = 0; i < workingLines.length; i++) {
    const line = workingLines[i];
    const lineNumber = i + 1;
    const trimmed = line.trim();

    if (!trimmed) {
      if (inRawHttpBlock && rawHttpBuffer.length > 0) {
        const candidateText = rawHttpBuffer.join('\n');
        const rawReq = parseRawHttpRequest(candidateText, rawHttpStartLine);
        if (rawReq) results.push(rawReq);
        inRawHttpBlock = false;
        rawHttpBuffer = [];
      }
      continue;
    }

    // 5a. Handle active Multiline JSON accumulation
    if (inJsonBlock) {
      jsonBuffer.push(line);
      for (const ch of line) {
        if (ch === '{') jsonBraceCount++;
        else if (ch === '}') jsonBraceCount--;
      }

      if (jsonBraceCount <= 0) {
        const candidateJson = jsonBuffer.join('\n');
        try {
          const parsed = JSON.parse(candidateJson);
          const req = extractFromJsonObject(parsed, jsonStartLine, candidateJson);
          if (req) results.push(req);
        } catch {
          const jsReq = parseJsObjectLog(candidateJson, jsonStartLine);
          if (jsReq) results.push(jsReq);
        }
        inJsonBlock = false;
        jsonBuffer = [];
        jsonBraceCount = 0;
      }
      continue;
    }

    // 5b. Check if line starts a raw HTTP block (e.g. "POST /api/v1 HTTP/1.1")
    if (/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\S+\s+HTTP\/[0-9.]+/i.test(trimmed)) {
      if (inRawHttpBlock && rawHttpBuffer.length > 0) {
        const candidateText = rawHttpBuffer.join('\n');
        const rawReq = parseRawHttpRequest(candidateText, rawHttpStartLine);
        if (rawReq) results.push(rawReq);
      }
      inRawHttpBlock = true;
      rawHttpBuffer = [line];
      rawHttpStartLine = lineNumber;
      continue;
    }

    if (inRawHttpBlock) {
      rawHttpBuffer.push(line);
      continue;
    }

    // 5c. Try single-line JSON or start of multiline JSON
    if (trimmed.startsWith('{') || trimmed.includes('{"')) {
      const jsonReqs = parseJsonLog(trimmed, lineNumber);
      if (jsonReqs.length > 0) {
        results.push(...jsonReqs);
        continue;
      } else if (trimmed.startsWith('{')) {
        let openBraces = 0;
        for (const ch of trimmed) {
          if (ch === '{') openBraces++;
          else if (ch === '}') openBraces--;
        }
        if (openBraces > 0) {
          inJsonBlock = true;
          jsonBuffer = [line];
          jsonBraceCount = openBraces;
          jsonStartLine = lineNumber;
          continue;
        }
      }
    }

    // 5d. Try JS Object / Python Dict parser (handles single-quoted objects like { 'url': '...', 'headers': ... })
    if (trimmed.includes("{'") || trimmed.includes("':") || (trimmed.includes('url') && trimmed.includes('{'))) {
      const jsReq = parseJsObjectLog(trimmed, lineNumber);
      if (jsReq) {
        results.push(jsReq);
        continue;
      }
    }

    // 5e. Try Access Log parser (Nginx/Apache/Envoy)
    const accessReq = parseAccessLog(trimmed, lineNumber);
    if (accessReq) {
      results.push(accessReq);
      continue;
    }

    // 5f. Try Debug Log / Framework / Logfmt / Embedded cURL parser
    const debugReq = parseDebugLog(trimmed, lineNumber);
    if (debugReq) {
      results.push(debugReq);
      continue;
    }
  }

  // Flush any trailing blocks
  if (inRawHttpBlock && rawHttpBuffer.length > 0) {
    const candidateText = rawHttpBuffer.join('\n');
    const rawReq = parseRawHttpRequest(candidateText, rawHttpStartLine);
    if (rawReq) results.push(rawReq);
  }

  if (inJsonBlock && jsonBuffer.length > 0) {
    const candidateJson = jsonBuffer.join('\n');
    try {
      const parsed = JSON.parse(candidateJson);
      const req = extractFromJsonObject(parsed, jsonStartLine, candidateJson);
      if (req) results.push(req);
    } catch {
      const jsReq = parseJsObjectLog(candidateJson, jsonStartLine);
      if (jsReq) results.push(jsReq);
    }
  }

  return results;
}
