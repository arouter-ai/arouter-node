/**
 * SIWx (Sign-In-With-X) authentication for ARouter.
 *
 * Allows wallet-based authentication via the x402 CAIP-122 standard.
 * The wallet signs a SIWx message, sends it to POST /v1/x402/auth,
 * and receives an API key for subsequent requests.
 *
 * @example EVM
 * ```typescript
 * import { ARouter } from "@arouter/sdk";
 * import { authenticateWithSIWx } from "@arouter/sdk/siwx";
 * import { privateKeyToAccount } from "viem/accounts";
 *
 * const account = privateKeyToAccount("0x...");
 * const { apiKey } = await authenticateWithSIWx("https://api.arouter.ai", {
 *   address: account.address,
 *   signMessage: (msg) => account.signMessage({ message: msg }),
 * });
 * const client = new ARouter({ baseURL: "https://api.arouter.ai", apiKey });
 * ```
 */

import type { ARouter } from "./client";

/** Wallet signer for SIWx authentication. */
export interface WalletSigner {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

export interface SIWxOptions {
  /** Override the chain ID (e.g. "8453" for Base). Defaults to "8453" for EVM, mainnet for Solana. */
  chainId?: string;
  /** Custom statement shown to the user during signing. */
  statement?: string;
}

export interface SIWxAuthResult {
  apiKey: string;
  tenantId: string;
  keyId: string;
}

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Creates a SIWx (EIP-4361 / SIWS) message string for signing.
 */
function createSIWxMessage(
  domain: string,
  address: string,
  chainType: "evm" | "solana",
  opts?: SIWxOptions,
): string {
  const chainLabel = chainType === "evm" ? "Ethereum" : "Solana";
  const statement = opts?.statement ?? "Sign in to ARouter with your wallet";
  const nonce = generateNonce();
  const issuedAt = new Date().toISOString();
  const chainId = opts?.chainId ?? (chainType === "evm" ? "8453" : "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");

  return [
    `${domain} wants you to sign in with your ${chainLabel} account:`,
    address,
    "",
    statement,
    "",
    `URI: https://${domain}/v1/x402/auth`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

/**
 * Authenticates with ARouter using SIWx (Sign-In-With-X).
 * Returns an API key that can be used for all subsequent requests.
 */
export async function authenticateWithSIWx(
  baseURL: string,
  signer: WalletSigner,
  opts?: SIWxOptions,
): Promise<SIWxAuthResult> {
  const url = new URL("/v1/x402/auth", baseURL);
  const domain = url.host; // includes port for non-standard ports
  const chainType: "evm" | "solana" = signer.address.startsWith("0x") ? "evm" : "solana";

  const message = createSIWxMessage(domain, signer.address, chainType, opts);
  const signature = await signer.signMessage(message);

  const payload = JSON.stringify({ message, signature });
  const header = btoa(payload);

  const resp = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "SIGN-IN-WITH-X": header,
      "Content-Type": "application/json",
    },
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SIWx authentication failed (${resp.status}): ${body}`);
  }

  const data = await resp.json();

  return {
    apiKey: data.api_key ?? "",
    tenantId: data.tenant_id ?? "",
    keyId: data.key_id ?? "",
  };
}

/**
 * Wraps an ARouter client with SIWx authentication.
 * On first call, authenticates via SIWx and caches the API key.
 */
export async function withSIWxAuth(
  client: ARouter,
  signer: WalletSigner,
  opts?: SIWxOptions,
): Promise<ARouter> {
  const baseURL = (client as any).baseURL as string;
  const { apiKey } = await authenticateWithSIWx(baseURL, signer, opts);
  return client.cloneWith({ apiKey });
}
