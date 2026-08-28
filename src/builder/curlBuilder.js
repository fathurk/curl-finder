/**
 * Safely escapes a string for single-quoted bash / zsh shell arguments.
 * Example: "hello'world" -> "'hello'\''world'"
 */
export function escapeShellArg(str) {
  if (str === null || str === undefined) return "''";
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

/**
 * Builds a valid, runnable cURL command from a parsed HTTP request object.
 *
 * @param {object} request - Parsed request object
 * @param {object} options - Builder options
 * @param {string} [options.baseUrl] - Base URL to prepend if URL is relative
 * @param {boolean} [options.multiline=true] - Whether to format as multiline with backslashes
 * @param {boolean} [options.maskHeaders=false] - Whether to mask sensitive headers like Authorization
 * @param {boolean} [options.compressed=true] - Add --compressed flag
 * @param {boolean} [options.insecure=false] - Add -k / --insecure flag
 * @param {boolean} [options.followRedirects=false] - Add -L flag
 * @returns {string} - The formatted curl command
 */
export function buildCurlCommand(request, options = {}) {
  const {
    baseUrl = '',
    multiline = true,
    maskHeaders = false,
    compressed = false,
    insecure = false,
    followRedirects = false
  } = options;

  const method = (request.method || 'GET').toUpperCase();
  let targetUrl = (request.url || '/').trim();

  // Resolve relative URL with baseUrl
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    if (baseUrl) {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const cleanPath = targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`;
      targetUrl = `${cleanBase}${cleanPath}`;
    }
  }

  const parts = ['curl'];

  // HTTP Method
  if (method !== 'GET') {
    parts.push(`-X ${method}`);
  }

  // URL
  parts.push(escapeShellArg(targetUrl));

  // Flags
  if (followRedirects) parts.push('-L');
  if (insecure) parts.push('-k');
  if (compressed) parts.push('--compressed');

  // Headers
  const headers = request.headers || {};
  let hasContentType = false;

  for (const [rawKey, rawVal] of Object.entries(headers)) {
    const key = rawKey.trim();
    if (!key) continue;

    // Skip Content-Length as curl calculates it automatically
    if (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'host') {
      continue;
    }

    if (key.toLowerCase() === 'content-type') {
      hasContentType = true;
    }

    let val = String(rawVal);
    if (maskHeaders) {
      if (key.toLowerCase() === 'authorization' && val.toLowerCase().startsWith('bearer ')) {
        val = 'Bearer ********';
      } else if (key.toLowerCase() === 'authorization' && val.toLowerCase().startsWith('basic ')) {
        val = 'Basic ********';
      } else if (/^(cookie|x-api-key|api-key|secret|token)$/i.test(key)) {
        val = '********';
      }
    }

    parts.push(`-H ${escapeShellArg(`${key}: ${val}`)}`);
  }

  // Body
  if (request.body !== null && request.body !== undefined) {
    let bodyStr = request.body;
    if (typeof bodyStr === 'object') {
      try {
        bodyStr = JSON.stringify(bodyStr);
      } catch {
        bodyStr = String(bodyStr);
      }
    } else {
      bodyStr = String(bodyStr).trim();
    }

    if (bodyStr.length > 0) {
      // Auto-add application/json header if body is JSON and Content-Type was missing
      if (!hasContentType && (bodyStr.startsWith('{') || bodyStr.startsWith('['))) {
        parts.push(`-H 'Content-Type: application/json'`);
      }
      parts.push(`-d ${escapeShellArg(bodyStr)}`);
    }
  }

  if (multiline) {
    // Format nicely across lines with backslashes
    const [first, ...rest] = parts;
    if (rest.length === 0) return first;
    return `${first} \\\n  ` + rest.join(' \\\n  ');
  } else {
    return parts.join(' ');
  }
}
