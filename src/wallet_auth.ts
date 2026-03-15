/**
 * Wallet-based authentication for x402 zero-registration flow.
 *
 * Every request is signed with the wallet's private key to prove ownership.
 * No API key needed — the wallet IS the identity.
 *
 * @example
 * ```typescript
 * import { ARouter, withWalletAuth } from "arouter";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const account = privateKeyToAccount("0x...");
 * const client = withWalletAuth(
 *   new ARouter({ baseURL: "https://api.arouter.ai", apiKey: "" }),
 *   {
 *     address: account.address,
 *     signMessage: (msg) => account.signMessage({ message: msg }),
 *   },
 * );
 * ```
 */

const HEADER_WALLET_AUTH = "X-Wallet-Auth";

/**
 * WalletSigner signs messages to prove wallet ownership.
 * Implement using viem, ethers, or any EVM signing library.
 */
export interface WalletSigner {
  /** Wallet address (e.g. "0x...") */
  address: string;
  /** Sign a message string, return hex signature (0x-prefixed, 65 bytes) */
  signMessage(message: string): Promise<string>;
}

export interface WalletAuthOptions {
  /** Wallet signer for authentication */
  address: string;
  /** Sign a message string, return hex signature */
  signMessage: (message: string) => Promise<string>;
}

/**
 * Wraps an ARouter client with wallet-based authentication.
 *
 * Every request will include an X-Wallet-Auth header with a signed message
 * proving wallet ownership. No API key is needed.
 *
 * Combine with @x402/fetch for automatic payment handling:
 * ```typescript
 * import { wrapFetchWithPayment } from "@x402/fetch";
 * import { withWalletAuth } from "arouter";
 *
 * const client = withWalletAuth(
 *   new ARouter({ baseURL, apiKey: "" }),
 *   { address: signer.address, signMessage: (msg) => signer.signMessage({ message: msg }) },
 * );
 * ```
 */
export function withWalletAuth<T extends object>(
  client: T,
  opts: WalletAuthOptions,
): T {
  const origFetch = globalThis.fetch;

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      return function (this: unknown, ...args: unknown[]) {
        const callTarget = this === receiver ? target : this;

        // Temporarily wrap fetch to inject wallet auth header
        const prevFetch = globalThis.fetch;
        let restored = false;

        const walletFetch: typeof fetch = async (input, init) => {
          if (!restored) {
            restored = true;
            globalThis.fetch = prevFetch;
          }

          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
          const method = init?.method ?? (input instanceof Request ? input.method : "GET");
          const path = new URL(url).pathname;

          const ts = Math.floor(Date.now() / 1000);

          // Compute body hash for replay protection
          let bodyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
          const bodyContent = init?.body;
          if (bodyContent && typeof bodyContent === "string") {
            const encoder = new TextEncoder();
            const data = encoder.encode(bodyContent);
            const hashBuffer = await crypto.subtle.digest("SHA-256", data);
            bodyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
          }

          const message = `arouter:${ts}:${method}:${path}:${bodyHash}`;
          const signature = await opts.signMessage(message);

          const headers = new Headers(init?.headers);
          headers.set(HEADER_WALLET_AUTH, `${opts.address}:${ts}:${signature}`);
          // Remove empty Bearer when using wallet auth
          const authHeader = headers.get("Authorization");
          if (authHeader === "Bearer " || authHeader === "Bearer") {
            headers.delete("Authorization");
          }

          return origFetch(input, { ...init, headers });
        };

        globalThis.fetch = walletFetch;
        try {
          const result = value.apply(callTarget, args);
          if (result && typeof result === "object" && "then" in result) {
            return (result as Promise<unknown>).finally(() => {
              globalThis.fetch = prevFetch;
            });
          }
          globalThis.fetch = prevFetch;
          return result;
        } catch (err) {
          globalThis.fetch = prevFetch;
          throw err;
        }
      };
    },
  });
}
