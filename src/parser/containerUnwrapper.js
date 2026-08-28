/**
 * Unwraps container/log-agent JSON wrappers like TKE (__CONTENT__), Docker (log),
 * Kubernetes, CloudWatch, GCP (textPayload), Fluentd/Loki (message).
 *
 * @param {string} rawText - Raw input text
 * @returns {{ unwrappedText: string, isWrapped: boolean, lines: string[] }}
 */
export function unwrapContainerLogs(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return { unwrappedText: rawText || '', isWrapped: false, lines: [] };
  }

  const rawLines = rawText.split(/\r?\n/);
  const extractedLines = [];
  let wrapCount = 0;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let unwrapped = null;

    if (trimmed.startsWith('{') && (trimmed.endsWith('}') || trimmed.includes('"__CONTENT__"') || trimmed.includes('"log"'))) {
      try {
        const obj = JSON.parse(trimmed);
        if (typeof obj.__CONTENT__ === 'string') {
          unwrapped = obj.__CONTENT__;
          wrapCount++;
        } else if (typeof obj.log === 'string') {
          unwrapped = obj.log;
          wrapCount++;
        } else if (typeof obj.message === 'string' && !obj.req && !obj.request) {
          unwrapped = obj.message;
          wrapCount++;
        } else if (typeof obj.textPayload === 'string') {
          unwrapped = obj.textPayload;
          wrapCount++;
        }
      } catch {
        // Not valid single-line JSON, check with regex
        const contentMatch = trimmed.match(/"(?:__CONTENT__|log|textPayload)":\s*"((?:\\.|[^"\\])*)"/);
        if (contentMatch) {
          try {
            unwrapped = JSON.parse(`"${contentMatch[1]}"`);
            wrapCount++;
          } catch {
            unwrapped = contentMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
            wrapCount++;
          }
        }
      }
    }

    if (unwrapped !== null) {
      extractedLines.push(unwrapped);
    } else {
      extractedLines.push(line);
    }
  }

  const isWrapped = wrapCount > 0;
  return {
    unwrappedText: extractedLines.join('\n'),
    isWrapped,
    lines: extractedLines
  };
}
