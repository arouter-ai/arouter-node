/**
 * Wallet-based authentication for x402 zero-registration flow.
 *
 * Creates a custom fetch that injects X-Wallet-Auth on every request.
 * No globalThis mutation — concurrency-safe.
 *
 * @example
 * ```typescript
 * import { ARouter } from "arouter";
 * import { createWalletAuthFetch } from "arouter/wallet_auth";
 *
 * const walletFetch = createWalletAuthFetch(fetch, {
 *   address: account.address,
 *   signMessage: (msg) => account.signMessage({ message: msg }),
 * });
 *
 * const client = new ARouter({
 *   baseURL: "https://api.arouter.ai",
 *   apiKey: "",
 *   customFetch: walletFetch,
 * });
 * ```
 */

const HEADER_WALLET_AUTH = "X-Wallet-Auth";

/**
 * WalletSigner signs messages to prove wallet ownership.
 */
export interface WalletSigner {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

export interface WalletAuthOptions {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

/**
 * Creates a fetch function that injects X-Wallet-Auth header on every request.
 * Concurrency-safe: no global state mutation.
 *
 * Body hash covers string bodies (JSON). For FormData (multipart), uses the
 * empty-body hash — server accepts this for multipart requests.
 */
export function createWalletAuthFetch(
  baseFetch: typeof fetch,
  opts: WalletAuthOptions,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    let parsedPath: string;
    try {
      parsedPath = new URL(url).pathname;
    } catch {
      parsedPath = url.startsWith("/") ? url.split("?")[0] : "/";
    }

    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const ts = Math.floor(Date.now() / 1000);

    // Body hash: cover string bodies (JSON), use empty hash for FormData/other
    const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let bodyHash = emptyHash;
    const bodyContent = init?.body;
    if (bodyContent && typeof bodyContent === "string") {
      const encoder = new TextEncoder();
      const data = encoder.encode(bodyContent);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      bodyHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    const message = `arouter:${ts}:${method}:${parsedPath}:${bodyHash}`;
    const signature = await opts.signMessage(message);

    const headers = new Headers(init?.headers);
    headers.set(HEADER_WALLET_AUTH, `${opts.address}:${ts}:${signature}`);

    // Remove empty Bearer when using wallet auth
    const authHeader = headers.get("Authorization");
    if (authHeader === "Bearer " || authHeader === "Bearer") {
      headers.delete("Authorization");
    }

    return baseFetch(input, { ...init, headers });
  };
}

/**
 * Convenience: wraps an ARouter client with wallet auth.
 * Returns a new ARouter instance with customFetch set.
 */
export function withWalletAuth<T extends { constructor: Function }>(
  client: T,
  opts: WalletAuthOptions,
): T {
  // Access the client's config to create a new instance with customFetch
  // Since ARouter constructor is public, we create a new one
  const config = (client as any);
  const walletFetch = createWalletAuthFetch(config._fetch ?? globalThis.fetch, opts);

  return new (client.constructor as any)({
    baseURL: config.baseURL,
    apiKey: config.apiKey ?? "",
    timeout: config.timeout,
    customFetch: walletFetch,
  }) as T;
}
