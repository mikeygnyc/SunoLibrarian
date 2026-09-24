const REDACTED = "[REDACTED]";

const SENSITIVE_KEYS = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "authtoken",
  "bearertoken",
  "clientsecret",
  "cookie",
  "password",
  "passwd",
  "refreshtoken",
  "secret",
  "setcookie",
  "token",
]);

export function sanitizeLogData<T>(value: T): T {
  return sanitizeValue(value, new WeakSet<object>()) as T;
}

export function sanitizeLogMessage(message: string): string {
  return message
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(/\b((?:postgres(?:ql)?|mqtts?|https?):\/\/)([^\s/@]+)@/gi, `$1${REDACTED}@`)
    .replace(/\b(--token\s+)([^\s]+)/gi, `$1${REDACTED}`)
    .replace(/\b((?:access[_-]?token|auth[_-]?token|api[_-]?key|client[_-]?secret|password|passwd|token)\s*[=:]\s*)([^\s,;]+)/gi, `$1${REDACTED}`);
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return sanitizeLogMessage(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeLogMessage(value.message),
      stack: value.stack ? sanitizeLogMessage(value.stack) : undefined,
    };
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const sanitized = value.map((item) => sanitizeValue(item, seen));
    seen.delete(value);
    return sanitized;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key)
      ? REDACTED
      : sanitizeValue(nestedValue, seen);
  }
  seen.delete(value);
  return sanitized;
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}
