/** Options accepted by {@link HttpError} and every factory. */
export interface HttpErrorOptions {
  /**
   * Whether `message` may be sent to the client. Defaults to `true` for
   * `status < 500`, `false` otherwise — 5xx messages may leak internals.
   */
  readonly expose?: boolean;
  /** Wraps an underlying error (ES2022 cause chain). */
  readonly cause?: unknown;
  /** Custom JSON body — replaces the default `{ error, message? }` shape. */
  readonly body?: unknown;
  /** Extra response headers (e.g. `WWW-Authenticate`, `Allow`, `Retry-After`). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Structured HTTP error. Throw one from a handler or middleware to emit
 * a response with the correct status, headers, and body. Distinguish
 * errors by `status` — subclassing is not required.
 */
export class HttpError extends Error {
  override readonly name = "HttpError";
  readonly status: number;
  readonly expose: boolean;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, message?: string, options: HttpErrorOptions = {}) {
    // Forward `cause` conditionally so `error.cause` is absent when omitted.
    super(
      message ?? defaultMessageFor(status),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.status = status;
    this.expose = options.expose ?? status < 500;
    this.body = options.body;
    this.headers = options.headers ?? EMPTY_HEADERS;
  }
}

const EMPTY_HEADERS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Canonical reason phrases for common status codes. Used as default
 * `HttpError` messages and as OpenAPI response descriptions. Codes outside
 * the map fall back to a generic reason at the consumer.
 */
export const STATUS_NAMES: Readonly<Record<number, string>> = Object.freeze({
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  507: "Insufficient Storage",
  508: "Loop Detected",
  511: "Network Authentication Required",
});

function defaultMessageFor(status: number): string {
  return STATUS_NAMES[status] ?? "Error";
}

/** Functional alias for `new HttpError(...)`. */
export function httpError(status: number, message?: string, options?: HttpErrorOptions): HttpError {
  return new HttpError(status, message, options);
}

/** `400 Bad Request` */
export const badRequest = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(400, message, options);

/** `401 Unauthorized` */
export const unauthorized = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(401, message, options);

/** `403 Forbidden` */
export const forbidden = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(403, message, options);

/** `404 Not Found` */
export const notFound = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(404, message, options);

/** `405 Method Not Allowed` */
export const methodNotAllowed = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(405, message, options);

/** `409 Conflict` */
export const conflict = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(409, message, options);

/** `410 Gone` */
export const gone = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(410, message, options);

/** `413 Payload Too Large` */
export const payloadTooLarge = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(413, message, options);

/** `415 Unsupported Media Type` */
export const unsupportedMediaType = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(415, message, options);

/** `422 Unprocessable Entity` */
export const unprocessableEntity = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(422, message, options);

/** `429 Too Many Requests` */
export const tooManyRequests = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(429, message, options);

/** `500 Internal Server Error` */
export const internalServerError = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(500, message, options);

/** `501 Not Implemented` */
export const notImplemented = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(501, message, options);

/** `502 Bad Gateway` */
export const badGateway = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(502, message, options);

/** `503 Service Unavailable` */
export const serviceUnavailable = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(503, message, options);

/** `504 Gateway Timeout` */
export const gatewayTimeout = (message?: string, options?: HttpErrorOptions): HttpError =>
  new HttpError(504, message, options);
