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
const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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
 * Body hash rule (must match server-side x402Gate):
 *   SHA-256 of the exact request body bytes, regardless of Content-Type.
 *   For FormData, the body is pre-serialized so the hash covers the real
 *   multipart payload including the boundary — same bytes the server reads.
 */
export function createWalletAuthFetch(
  baseFetch: typeof fetch,
  opts: WalletSigner,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const isRequest = input instanceof Request;
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    let parsedPath: string;
    try {
      parsedPath = new URL(url).pathname;
    } catch {
      parsedPath = url.startsWith("/") ? url.split("?")[0] : "/";
    }

    const method = init?.method ?? (isRequest ? input.method : "GET");
    const ts = Math.floor(Date.now() / 1000);

    // When called with a Request object (e.g. by @x402/fetch retry),
    // init is undefined — read body from the Request itself.
    let rawBody: BodyInit | null | undefined = init?.body;
    if (rawBody === undefined && isRequest) {
      const cloned = input.clone();
      const text = await cloned.text();
      rawBody = text || undefined;
    }

    const { bodyHash, resolvedBody, extraHeaders } = await hashRequestBody(rawBody);

    const message = `arouter:${ts}:${method}:${parsedPath}:${bodyHash}`;
    const signature = await opts.signMessage(message);

    const headers = new Headers(isRequest && !init?.headers ? input.headers : init?.headers);
    headers.set(HEADER_WALLET_AUTH, `${opts.address}:${ts}:${signature}`);
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }

    const authHeader = headers.get("Authorization");
    if (authHeader === "Bearer " || authHeader === "Bearer") {
      headers.delete("Authorization");
    }

    return baseFetch(url, { ...init, method, headers, body: resolvedBody });
  };
}

/**
 * Hash the request body, handling string, FormData, ArrayBuffer, and other types.
 *
 * For FormData: pre-serializes via a temporary Request so the boundary is fixed,
 * then hashes and returns the serialized bytes + Content-Type (with boundary).
 * This guarantees the hash matches what the server will read.
 */
async function hashRequestBody(
  body: BodyInit | null | undefined,
): Promise<{ bodyHash: string; resolvedBody: BodyInit | undefined; extraHeaders: Record<string, string> }> {
  if (!body) {
    return { bodyHash: EMPTY_HASH, resolvedBody: undefined, extraHeaders: {} };
  }

  if (typeof body === "string") {
    return { bodyHash: await sha256Hex(new TextEncoder().encode(body)), resolvedBody: body, extraHeaders: {} };
  }

  if (body instanceof FormData) {
    const tempReq = new Request("http://localhost", { method: "POST", body });
    const serialized = new Uint8Array(await tempReq.arrayBuffer());
    const contentType = tempReq.headers.get("content-type")!;
    return {
      bodyHash: await sha256Hex(serialized),
      resolvedBody: serialized,
      extraHeaders: { "Content-Type": contentType },
    };
  }

  if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : body;
    return { bodyHash: await sha256Hex(bytes), resolvedBody: body, extraHeaders: {} };
  }

  if (body instanceof Blob) {
    const bytes = new Uint8Array(await body.arrayBuffer());
    return { bodyHash: await sha256Hex(bytes), resolvedBody: bytes, extraHeaders: {} };
  }

  // ReadableStream cannot be hashed without consuming it — reject explicitly
  throw new Error("ReadableStream body is not supported with wallet auth; use string, FormData, or ArrayBuffer");
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
