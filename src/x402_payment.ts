/**
 * x402 automatic payment using Coinbase's official @x402 SDK.
 *
 * When the server returns 402 + PAYMENT-REQUIRED, the SDK automatically
 * signs a payment and retries. Works with EVM (Base) and Solana networks.
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
import { createWalletAuthFetch, type WalletSigner } from "./wallet_auth";

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
 * Wraps an ARouter client with EVM x402 automatic payment + wallet auth.
 */
export function withX402EvmPayment(
  client: ARouter,
  evmSigner: EvmPaymentSigner,
  walletAuth?: WalletSigner,
): ARouter {
  const x402 = new x402Client();
  // ExactEvmScheme expects a viem-compatible account
  x402.register("eip155:*", new ExactEvmScheme(evmSigner as any));

  const walletSigner: WalletSigner = walletAuth ?? {
    address: evmSigner.address,
    signMessage: (msg: string) => evmSigner.signMessage({ message: msg }),
  };

  const walletFetch = createWalletAuthFetch(globalThis.fetch, walletSigner);
  const paymentFetch = wrapFetchWithPayment(walletFetch, x402);

  return client.cloneWith({ customFetch: paymentFetch });
}

/**
 * Wraps an ARouter client with Solana x402 automatic payment + wallet auth.
 */
export function withX402SolanaPayment(
  client: ARouter,
  svmSigner: SvmPaymentSigner,
  walletAuth: WalletSigner,
): ARouter {
  const x402 = new x402Client();
  x402.register("solana:*", new ExactSvmScheme(svmSigner));

  const walletFetch = createWalletAuthFetch(globalThis.fetch, walletAuth);
  const paymentFetch = wrapFetchWithPayment(walletFetch, x402);

  return client.cloneWith({ customFetch: paymentFetch });
}

/**
 * Wraps an ARouter client with dual-chain (EVM + Solana) x402 payment + wallet auth.
 */
export function withX402Payment(
  client: ARouter,
  opts: {
    evm?: { signer: EvmPaymentSigner; walletAuth?: WalletSigner };
    solana?: { signer: SvmPaymentSigner; walletAuth: WalletSigner };
  },
): ARouter {
  const x402 = new x402Client();

  if (opts.evm) {
    x402.register("eip155:*", new ExactEvmScheme(opts.evm.signer as any));
  }
  if (opts.solana) {
    x402.register("solana:*", new ExactSvmScheme(opts.solana.signer));
  }

  const walletSigner: WalletSigner | undefined =
    opts.evm?.walletAuth ??
    (opts.evm
      ? {
          address: opts.evm.signer.address,
          signMessage: (msg: string) => opts.evm!.signer.signMessage({ message: msg }),
        }
      : opts.solana?.walletAuth);

  let baseFetch: typeof fetch = globalThis.fetch;
  if (walletSigner) {
    baseFetch = createWalletAuthFetch(baseFetch, walletSigner);
  }
  const paymentFetch = wrapFetchWithPayment(baseFetch, x402);

  return client.cloneWith({ customFetch: paymentFetch });
}
