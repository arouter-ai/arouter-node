/**
 * x402 payment protocol support for the ARouter Node.js SDK.
 *
 * When the server responds with 402 + PAYMENT-REQUIRED header, the client
 * automatically signs a payment and retries the request with the
 * PAYMENT-SIGNATURE header.
 *
 * @example
 * ```typescript
 * import { ARouter, withX402, type X402Signer } from "arouter";
 *
 * const signer: X402Signer = {
 *   async signPayment(paymentRequired) {
 *     // Use viem/ethers to sign the payment
 *     return signedPayload;
 *   }
 * };
 *
 * const client = withX402(
 *   new ARouter({ baseURL: "https://api.arouter.ai", apiKey: "lr_live_..." }),
 *   { signer },
 * );
 * ```
 */

import { InsufficientCreditsError } from "./errors";

const HEADER_PAYMENT_SIGNATURE = "payment-signature";

/** Decoded PAYMENT-REQUIRED object from the x402 protocol. */
export interface PaymentRequired {
  accepts: Array<{
    scheme: string;
    payTo: string;
    price: string;
    network: string;
    maxTimeoutSeconds?: number;
  }>;
  description?: string;
  mimeType?: string;
  resource?: string;
}

/**
 * X402Signer signs payment payloads for the x402 protocol.
 * Implement this interface for your blockchain network (EVM, Solana, etc.).
 */
export interface X402Signer {
  signPayment(paymentRequired: PaymentRequired): Promise<Uint8Array>;
}

export interface X402Options {
  signer: X402Signer;
  /** Maximum number of payment retry attempts. Default: 1 */
  maxRetries?: number;
}

/**
 * Wraps an ARouter client with x402 automatic payment handling.
 *
 * When a method throws InsufficientCreditsError (402) with a PAYMENT-REQUIRED
 * header, the wrapper signs a payment and retries the request.
 *
 * Concurrency-safe: no global state mutation. Each call is independently
 * wrapped via Proxy on the returned Promise's catch handler.
 */
export function withX402<T extends object>(client: T, opts: X402Options): T {
  const maxRetries = opts.maxRetries ?? 1;

  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      return function (this: unknown, ...args: unknown[]) {
        const callTarget = this === receiver ? target : this;
        const result = value.apply(callTarget, args);

        if (!result || typeof result !== "object" || !("then" in result)) {
          return result;
        }

        return (result as Promise<unknown>).catch(async (err: unknown) => {
          if (!(err instanceof InsufficientCreditsError) || !err.paymentRequired) {
            throw err;
          }

          let paymentRequired: PaymentRequired;
          try {
            paymentRequired = JSON.parse(atob(err.paymentRequired));
          } catch {
            throw err;
          }

          for (let attempt = 0; attempt < maxRetries; attempt++) {
            const signedPayload = await opts.signer.signPayment(paymentRequired);
            const signature = uint8ToBase64(signedPayload);

            // Retry: temporarily wrap fetch to inject the signature header
            const origFetch = globalThis.fetch;
            let restored = false;
            const patchedFetch: typeof fetch = (input, init) => {
              if (!restored) {
                restored = true;
                globalThis.fetch = origFetch;
              }
              const headers = new Headers(init?.headers);
              headers.set(HEADER_PAYMENT_SIGNATURE, signature);
              return origFetch(input, { ...init, headers });
            };

            globalThis.fetch = patchedFetch;
            try {
              return await value.apply(callTarget, args);
            } catch (retryErr: unknown) {
              if (!(retryErr instanceof InsufficientCreditsError)) {
                throw retryErr;
              }
              // Payment still insufficient — try next attempt
            } finally {
              globalThis.fetch = origFetch;
            }
          }

          throw err;
        });
      };
    },
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
