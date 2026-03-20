import { ARouter, withX402EvmPayment } from "../src/index";
import { privateKeyToAccount } from "viem/accounts";

const baseURL = process.env.AROUTER_BASE_URL ?? "http://localhost:19080";
const key = process.env.EVM_PRIVATE_KEY as `0x${string}` | undefined;

if (!key) {
  console.error("EVM_PRIVATE_KEY is required");
  process.exit(1);
}

const signer = privateKeyToAccount(key);
const client = withX402EvmPayment(
  new ARouter({ baseURL, apiKey: "" }),
  signer,
  { chainId: "84532" }, // Base Sepolia
);

async function main() {
  console.log(`Testing against: ${baseURL}`);
  console.log(`Wallet: ${signer.address}`);

  try {
    const resp = await client.chatCompletion({
      model: "openrouter/auto",
      messages: [{ role: "user", content: "Say hi in exactly 3 words" }],
    });
    console.log("Node EVM x402 PASS");
    console.log(`Response: ${resp.choices[0]?.message?.content ?? ""}`);
  } catch (err) {
    console.error("Node EVM x402 FAIL");
    console.error(err);
    process.exit(1);
  }
}

main();
