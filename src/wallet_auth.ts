/**
 * Wallet-based authentication for x402 zero-registration flow.
 *
 * Creates a custom fetch that injects X-Wallet-Auth on every request.
 * No globalThis mutation — concurrency-safe.
 *
 * @example
 * ```typescript
 * import { ARouter, withWalletAuth } from "arouter";
 *
 * const client = withWalletAuth(
 *   new ARouter({ baseURL: "https://api.arouter.ai", apiKey: "" }),
 *   {
 *     address: account.address,
 *     signMessage: (msg) => account.signMessage({ message: msg }),
 *   },
 * );
 * ```
 */

import type { ARouter } from "./client";

const HEADER_WALLET_AUTH = "X-Wallet-Auth";

/**
 * WalletSigner signs messages to prove wallet ownership.
 */
export interface WalletSigner {
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
  opts: WalletSigner,
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

    const authHeader = headers.get("Authorization");
    if (authHeader === "Bearer " || authHeader === "Bearer") {
      headers.delete("Authorization");
    }

    return baseFetch(input, { ...init, headers });
  };
}

/**
 * Wraps an ARouter client with wallet auth.
 * Returns a new ARouter instance with customFetch set — the original is unchanged.
 */
export function withWalletAuth(
  client: ARouter,
  opts: WalletSigner,
): ARouter {
  return client.cloneWith({
    customFetch: createWalletAuthFetch(globalThis.fetch, opts),
  });
}
