/** Errors that map 1:1 to RFC 7807 responses via the app error handler. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly detail?: string,
    /** Per-field problems (e.g. form answers), rendered as `errors` in the problem body. */
    readonly errors?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, detail?: string) => new HttpError(400, msg, detail);
export const unauthorized = (detail?: string) => new HttpError(401, 'Unauthorized', detail);
export const forbidden = (detail?: string) => new HttpError(403, 'Forbidden', detail);
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const conflict = (msg: string, detail?: string) => new HttpError(409, msg, detail);

/** Plan entitlement exceeded (spec §12). 402 signals "upgrade to proceed". */
export class LimitExceededError extends HttpError {
  constructor(
    readonly limitKey: string,
    readonly limit: number,
  ) {
    super(402, 'Plan limit reached', `The plan allows ${limit} ${limitKey.replace(/_/g, ' ')}.`);
  }
}
