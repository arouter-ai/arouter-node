/**
 * x402 automatic payment using Coinbase's official @x402 SDK.
 *
 * On first request the SDK pays via x402, caches the API key returned in the
 * X-API-Key response header, and uses it for all subsequent requests.
 * If credits run low, the x402 layer automatically tops up again.
 *
 * @example EVM only
 * ```typescript
 * import { ARouter, withX402EvmPayment } from "@arouter/sdk";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);
 * const client = withX402EvmPayment(
 *   new ARouter({ baseURL: "https://api.arouter.ai", apiKey: "" }),
 *   signer,
 * );
 * ```
 */

import type { ARouter } from "./client";

import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";

/** EVM signer interface (compatible with viem's Account) */
export interface EvmPaymentSigner {
  address: string;
  signMessage: (args: { message: string }) => Promise<string>;
}

/** Solana signer — pass result of @solana/kit createKeyPairSignerFromBytes */
export type SvmPaymentSigner = ConstructorParameters<typeof ExactSvmScheme>[0];

/**
 * Creates a fetch that wraps @x402/fetch for payment handling and caches the
 * API key returned in X-API-Key headers for subsequent requests.
 */
function createApiKeyCachingPaymentFetch(
  x402: InstanceType<typeof x402Client>,
): typeof fetch {
  let cachedApiKey: string | null = null;

  const paymentFetch = wrapFetchWithPayment(globalThis.fetch, x402);

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (cachedApiKey) {
      const headers = new Headers(init?.headers);
      const existing = headers.get("Authorization") ?? "";
      if (!existing || existing === "Bearer" || existing === "Bearer ") {
        headers.set("Authorization", `Bearer ${cachedApiKey}`);
      }
      init = { ...init, headers };
    }

    const resp = await paymentFetch(input, init);

    const newKey = resp.headers.get("X-API-Key");
    if (newKey) {
      cachedApiKey = newKey;
    }

    return resp;
  };
}

/**
 * Wraps an ARouter client with EVM x402 automatic payment.
 * First request triggers x402 payment → API key is cached → subsequent requests use Bearer.
 */
export function withX402EvmPayment(
  client: ARouter,
  evmSigner: EvmPaymentSigner,
): ARouter {
  const x402 = new x402Client();
  x402.register("eip155:*", new ExactEvmScheme(evmSigner as any));

  return client.cloneWith({ customFetch: createApiKeyCachingPaymentFetch(x402) });
}

/**
 * Wraps an ARouter client with Solana x402 automatic payment.
 */
export function withX402SolanaPayment(
  client: ARouter,
  svmSigner: SvmPaymentSigner,
): ARouter {
  const x402 = new x402Client();
  x402.register("solana:*", new ExactSvmScheme(svmSigner));

  return client.cloneWith({ customFetch: createApiKeyCachingPaymentFetch(x402) });
}

/**
 * Wraps an ARouter client with dual-chain (EVM + Solana) x402 payment.
 */
export function withX402Payment(
  client: ARouter,
  opts: {
    evm?: { signer: EvmPaymentSigner };
    solana?: { signer: SvmPaymentSigner };
  },
): ARouter {
  const x402 = new x402Client();

  if (opts.evm) {
    x402.register("eip155:*", new ExactEvmScheme(opts.evm.signer as any));
  }
  if (opts.solana) {
    x402.register("solana:*", new ExactSvmScheme(opts.solana.signer));
  }

  return client.cloneWith({ customFetch: createApiKeyCachingPaymentFetch(x402) });
}
