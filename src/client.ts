import {
  ARouterConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  ModelListResponse,
  CreateKeyRequest,
  CreateKeyResponse,
  UpdateKeyRequest,
  UpdateKeyResponse,
  ListKeysOptions,
  ListKeysResponse,
  DeleteKeyResponse,
  UsageQuery,
  UsageSummary,
  UsageTimeSeries,
} from "./types";
import {
  ARouterError,
  AuthenticationError,
  RateLimitError,
  QuotaExceededError,
} from "./errors";
import { parseSSEStream } from "./stream";

const DEFAULT_TIMEOUT = 60_000;

export class ARouter {
  private readonly baseURL: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(config: ARouterConfig) {
    this.baseURL = config.baseURL.replace(/\/+$/, "");
    this.apiKey = config.apiKey;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
  }

  // ── Chat Completion ──────────────────────────────────────────────

  async chatCompletion(
    req: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    const body = { ...req, stream: false };
    return this.request<ChatCompletionResponse>(
      "POST",
      "/v1/chat/completions",
      body,
    );
  }

  async *chatCompletionStream(
    req: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk> {
    const body = { ...req, stream: true };
    const response = await this.rawRequest("POST", "/v1/chat/completions", body);
    yield* parseSSEStream(response);
  }

  async listModels(): Promise<ModelListResponse> {
    return this.request<ModelListResponse>("GET", "/v1/models");
  }

  async createEmbedding(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    return this.request<EmbeddingResponse>("POST", "/v1/embeddings", req);
  }

  async proxyRequest(
    provider: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return this.rawRequest(
      body ? "POST" : "GET",
      `/${provider}${normalizedPath}`,
      body,
    );
  }

  // ── Key Management (aligned with OpenRouter) ───────────────────

  async createKey(req: CreateKeyRequest): Promise<CreateKeyResponse> {
    return this.request<CreateKeyResponse>("POST", "/api/v1/keys", req);
  }

  async listKeys(opts?: ListKeysOptions): Promise<ListKeysResponse> {
    const params = new URLSearchParams();
    if (opts?.page_size != null) params.set("page_size", String(opts.page_size));
    if (opts?.page_token != null) params.set("page_token", opts.page_token);
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    if (opts?.include_disabled) params.set("include_disabled", "true");
    const qs = params.toString();
    return this.request<ListKeysResponse>(
      "GET",
      `/api/v1/keys${qs ? `?${qs}` : ""}`,
    );
  }

  async updateKey(hash: string, req: UpdateKeyRequest): Promise<UpdateKeyResponse> {
    return this.request<UpdateKeyResponse>(
      "PATCH",
      `/api/v1/keys/${encodeURIComponent(hash)}`,
      req,
    );
  }

  async deleteKey(hash: string): Promise<DeleteKeyResponse> {
    return this.request<DeleteKeyResponse>(
      "DELETE",
      `/api/v1/keys/${encodeURIComponent(hash)}`,
    );
  }

  // ── Usage & Analytics ────────────────────────────────────────────

  async getUsageSummary(query: UsageQuery): Promise<UsageSummary> {
    const params = this.usageParams(query);
    return this.request<UsageSummary>("GET", `/api/usage/summary?${params}`);
  }

  async getUsageTimeSeries(query: UsageQuery): Promise<UsageTimeSeries> {
    const params = this.usageParams(query);
    return this.request<UsageTimeSeries>(
      "GET",
      `/api/usage/timeseries?${params}`,
    );
  }

  // ── Internals ────────────────────────────────────────────────────

  private usageParams(query: UsageQuery): string {
    const params = new URLSearchParams();
    params.set("start_time", query.start_time);
    params.set("end_time", query.end_time);
    if (query.provider_id) params.set("provider_id", query.provider_id);
    if (query.model) params.set("model", query.model);
    if (query.key_id) params.set("key_id", query.key_id);
    if (query.granularity) params.set("granularity", query.granularity);
    return params.toString();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.rawRequest(method, path, body);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async rawRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ARouterError(0, "timeout", `Request timed out after ${this.timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response;
  }

  private async handleErrorResponse(response: Response): Promise<never> {
    let body: { code?: string; message?: string; error?: { code?: number; message?: string } } = {};
    try {
      body = await response.json();
    } catch {
      // non-JSON error body
    }

    const message = body.error?.message ?? body.message ?? response.statusText;
    const code = body.code ?? "unknown_error";

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message);
      case 429: {
        const retryAfter = response.headers.get("Retry-After");
        throw new RateLimitError(
          message,
          retryAfter ? Number(retryAfter) : undefined,
        );
      }
      case 403:
        if (code === "quota_exceeded") {
          throw new QuotaExceededError(message);
        }
        throw new ARouterError(403, code, message);
      default:
        throw new ARouterError(response.status, code, message);
    }
  }
}
