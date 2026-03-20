/**
 * x402 automatic payment using Coinbase's official @x402 SDK.
 *
 * On first request the SDK pays via x402, caches the wallet JWT returned in
 * PAYMENT-RESPONSE, and uses it for all subsequent requests.
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
import { authenticateWithSIWx, type SIWxOptions, type WalletSigner } from "./siwx";

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

function fromBase64JSON<T>(value: string): T | null {
  try {
    const maybeBuffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString: (enc: string) => string } } }).Buffer;
    const decoded = maybeBuffer
      ? maybeBuffer.from(value, "base64").toString("utf8")
      : atob(value);
    return JSON.parse(decoded) as T;
  } catch {
    return null;
  }
}

/**
 * Creates a fetch that wraps @x402/fetch for payment handling and caches the
 * wallet JWT returned in PAYMENT-RESPONSE for subsequent requests.
 */
function createJwtCachingPaymentFetch(
  x402: InstanceType<typeof x402Client>,
  walletSigner?: WalletSigner,
  siwxOptions?: SIWxOptions,
): typeof fetch {
  let cachedJWT: string | null = null;
  let refreshPromise: Promise<string> | null = null;
  let bootstrapPromise: Promise<void> | null = null;

  const paymentFetch = wrapFetchWithPayment(globalThis.fetch, x402);

  const updateJWTFromResponse = async (resp: Response): Promise<void> => {
    const paymentResponse = resp.headers.get("PAYMENT-RESPONSE");
    if (!paymentResponse) return;
    const decoded = fromBase64JSON<{ jwt?: string }>(paymentResponse);
    if (decoded?.jwt) {
      cachedJWT = decoded.jwt;
    }
  };

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!cachedJWT && bootstrapPromise) {
      await bootstrapPromise;
    }

    if (cachedJWT) {
      const headers = new Headers(init?.headers);
      const existing = headers.get("Authorization") ?? "";
      if (!existing || existing === "Bearer" || existing === "Bearer ") {
        headers.set("Authorization", `Bearer ${cachedJWT}`);
      }
      init = { ...init, headers };
    }

    let resp: Response;
    if (!cachedJWT && !bootstrapPromise) {
      let resolveBootstrap!: () => void;
      let rejectBootstrap!: (reason?: unknown) => void;
      bootstrapPromise = new Promise<void>((resolve, reject) => {
        resolveBootstrap = resolve;
        rejectBootstrap = reject;
      });
      try {
        resp = await paymentFetch(input, init);
        await updateJWTFromResponse(resp);
        resolveBootstrap();
      } catch (err) {
        rejectBootstrap(err);
        throw err;
      } finally {
        bootstrapPromise = null;
      }
    } else {
      resp = await paymentFetch(input, init);
      await updateJWTFromResponse(resp);
    }

    if (resp.status === 401 && walletSigner) {
      if (!refreshPromise) {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        refreshPromise = authenticateWithSIWx(url.origin, walletSigner, siwxOptions)
          .then(({ jwt }) => {
            cachedJWT = jwt;
            return jwt;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }
      const jwt = await refreshPromise;
      if (jwt) {
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${jwt}`);
        resp = await paymentFetch(input, { ...init, headers: retryHeaders });
      }
    }

    return resp;
  };
}

/**
 * Wraps an ARouter client with EVM x402 automatic payment.
 * First request triggers x402 payment → wallet JWT is cached → subsequent requests use Bearer.
 */
export function withX402EvmPayment(
  client: ARouter,
  evmSigner: EvmPaymentSigner,
  siwxOptions?: SIWxOptions,
): ARouter {
  const x402 = new x402Client();
  x402.register("eip155:*", new ExactEvmScheme(evmSigner as any));

  const walletSigner: WalletSigner = {
    address: evmSigner.address,
    signMessage: (message: string) => evmSigner.signMessage({ message }),
  };
  return client.cloneWith({ customFetch: createJwtCachingPaymentFetch(x402, walletSigner, siwxOptions) });
}

/**
 * Wraps an ARouter client with Solana x402 automatic payment.
 */
export function withX402SolanaPayment(
  client: ARouter,
  svmSigner: SvmPaymentSigner,
  walletSigner?: WalletSigner,
  siwxOptions?: SIWxOptions,
): ARouter {
  const x402 = new x402Client();
  x402.register("solana:*", new ExactSvmScheme(svmSigner));

  return client.cloneWith({ customFetch: createJwtCachingPaymentFetch(x402, walletSigner, siwxOptions) });
}

/**
 * Wraps an ARouter client with dual-chain (EVM + Solana) x402 payment.
 *
 * `authSigner` is the wallet used for SIWx JWT renewal on 401. It MUST match the
 * wallet that was used for first registration/payment. If omitted, JWT auto-renewal
 * on 401 is disabled (the caller must handle re-authentication manually).
 */
export function withX402Payment(
  client: ARouter,
  opts: {
    evm?: { signer: EvmPaymentSigner };
    solana?: { signer: SvmPaymentSigner };
    authSigner?: WalletSigner;
    siwxOptions?: SIWxOptions;
  },
): ARouter {
  const x402 = new x402Client();

  if (opts.evm) {
    x402.register("eip155:*", new ExactEvmScheme(opts.evm.signer as any));
  }
  if (opts.solana) {
    x402.register("solana:*", new ExactSvmScheme(opts.solana.signer));
  }

  return client.cloneWith({ customFetch: createJwtCachingPaymentFetch(x402, opts.authSigner, opts.siwxOptions) });
}
