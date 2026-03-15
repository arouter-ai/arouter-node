export { ARouter } from "./client";

export {
  ARouterError,
  AuthenticationError,
  RateLimitError,
  QuotaExceededError,
  InsufficientCreditsError,
} from "./errors";

export { withX402 } from "./x402";
export type { X402Signer, X402Options, PaymentRequired } from "./x402";

export { withWalletAuth, createWalletAuthFetch } from "./wallet_auth";
export type { WalletSigner } from "./wallet_auth";

export type {
  ARouterConfig,
  Message,
  ToolCall,
  Tool,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Choice,
  ChunkChoice,
  Usage,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingData,
  EmbeddingUsage,
  ModelListResponse,
  ModelInfo,
  KeyObject,
  CreateKeyRequest,
  CreateKeyResponse,
  UpdateKeyRequest,
  UpdateKeyResponse,
  ListKeysOptions,
  ListKeysResponse,
  DeleteKeyResponse,
  UsageQuery,
  UsageSummary,
  ProviderUsage,
  ModelUsage,
  UsageTimeSeries,
  UsageDataPoint,
  ARouterErrorBody,
  AudioResponseFormat,
  TimestampGranularity,
  TranscriptionRequest,
  TranscriptionResponse,
  TranscriptionWord,
  TranscriptionSegment,
  TranslationRequest,
  TranslationResponse,
} from "./types";
