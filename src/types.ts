export interface ARouterConfig {
  baseURL: string;
  apiKey: string;
  timeout?: number;
  /** Custom fetch function for request interception (e.g. wallet auth, x402 payment). */
  customFetch?: typeof fetch;
}

// ── Chat Completion (OpenAI-compatible) ──────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  tools?: Tool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  response_format?: { type: "text" | "json_object" };
  user?: string;
}

export interface Tool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Choice[];
  usage?: Usage;
}

export interface Choice {
  index: number;
  message: Message;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChunkChoice[];
  usage?: Usage | null;
}

export interface ChunkChoice {
  index: number;
  delta: Partial<Message>;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

// ── Key Management (aligned with OpenRouter) ─────────────────────────

export interface KeyObject {
  hash: string;
  name: string;
  label?: string;
  key_type: "management" | "regular";
  disabled: boolean;
  limit: number | null;
  limit_remaining: number | null;
  limit_reset?: "daily" | "weekly" | "monthly" | null;
  allowed_providers?: string[];
  allowed_models?: string[];
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  created_at: string;
  updated_at?: string | null;
  expires_at?: string | null;
}

export interface CreateKeyRequest {
  name: string;
  limit?: number;
  limit_reset?: "daily" | "weekly" | "monthly";
  expires_at?: string;
  allowed_providers?: string[];
  allowed_models?: string[];
}

export interface CreateKeyResponse {
  data: KeyObject;
  key: string;
}

export interface UpdateKeyRequest {
  name?: string;
  disabled?: boolean;
  limit?: number;
  limit_reset?: "daily" | "weekly" | "monthly" | null;
  allowed_providers?: string[];
  allowed_models?: string[];
}

export interface UpdateKeyResponse {
  data: KeyObject;
}

export interface ListKeysOptions {
  page_size?: number;
  page_token?: string;
  offset?: number;
  include_disabled?: boolean;
}

export interface ListKeysResponse {
  data: KeyObject[];
}

export interface DeleteKeyResponse {
  data: { deleted: boolean };
}

// ── Embeddings (OpenAI-compatible) ───────────────────────────────────

export interface EmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: "float" | "base64";
}

export interface EmbeddingResponse {
  object: "list";
  data: EmbeddingData[];
  model: string;
  usage: EmbeddingUsage;
}

export interface EmbeddingData {
  object: "embedding";
  embedding: number[];
  index: number;
}

export interface EmbeddingUsage {
  prompt_tokens: number;
  total_tokens: number;
}

// ── Models ───────────────────────────────────────────────────────────

export interface ModelListResponse {
  object: "list";
  data: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

// ── Usage & Analytics ────────────────────────────────────────────────

export interface UsageQuery {
  start_time: string;
  end_time: string;
  provider_id?: string;
  model?: string;
  key_id?: string;
  granularity?: "hourly" | "daily" | "monthly";
}

export interface ProviderUsage {
  provider_id: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface ModelUsage {
  provider_id: string;
  model: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface UsageSummary {
  total_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  by_provider?: ProviderUsage[];
  by_model?: ModelUsage[];
}

export interface UsageTimeSeries {
  data_points: UsageDataPoint[];
}

export interface UsageDataPoint {
  timestamp: string;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

// ── Audio (OpenAI-compatible) ────────────────────────────────────────

export type AudioResponseFormat = "json" | "text" | "srt" | "verbose_json" | "vtt";
export type TimestampGranularity = "word" | "segment";

export interface TranscriptionRequest {
  file: Blob | File;
  model: string;
  language?: string;
  prompt?: string;
  response_format?: AudioResponseFormat;
  temperature?: number;
  timestamp_granularities?: TimestampGranularity[];
}

export interface TranscriptionResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  words?: TranscriptionWord[];
  segments?: TranscriptionSegment[];
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

export interface TranslationRequest {
  file: Blob | File;
  model: string;
  prompt?: string;
  response_format?: AudioResponseFormat;
  temperature?: number;
}

export interface TranslationResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  segments?: TranscriptionSegment[];
}

// ── Errors ───────────────────────────────────────────────────────────

export interface ARouterErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
