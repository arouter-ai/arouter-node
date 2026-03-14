export class ARouterError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ARouterError";
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AuthenticationError extends ARouterError {
  constructor(message = "Invalid or missing API key") {
    super(401, "authentication_error", message);
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends ARouterError {
  public readonly retryAfter?: number;

  constructor(message = "Rate limit exceeded", retryAfter?: number) {
    super(429, "rate_limit_exceeded", message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class QuotaExceededError extends ARouterError {
  constructor(message = "Monthly budget quota exceeded") {
    super(403, "quota_exceeded", message);
    this.name = "QuotaExceededError";
  }
}

export class InsufficientCreditsError extends ARouterError {
  public readonly paymentRequired?: string;

  constructor(message = "Insufficient credits, please top up your balance", paymentRequired?: string) {
    super(402, "insufficient_credits", message);
    this.name = "InsufficientCreditsError";
    this.paymentRequired = paymentRequired;
  }
}
