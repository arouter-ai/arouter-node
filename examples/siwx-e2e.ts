import { ARouter, authenticateWithSIWx, withSIWxAuth } from "../src/index";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const baseURL = process.env.AROUTER_BASE_URL ?? "http://localhost:19080";

async function main() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  console.log(`Testing against: ${baseURL}`);
  console.log(`Wallet: ${account.address}`);

  const auth = await authenticateWithSIWx(baseURL, {
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
  });
  if (!auth.jwt) {
    throw new Error("SIWx returned empty jwt");
  }
  console.log(`JWT: ${auth.jwt.slice(0, 24)}...`);
  console.log(`Tenant: ${auth.tenantId}`);

  const client = await withSIWxAuth(
    new ARouter({ baseURL, apiKey: "" }),
    {
      address: account.address,
      signMessage: (message) => account.signMessage({ message }),
    },
  );

  try {
    await client.chatCompletion({
      model: "test",
      messages: [{ role: "user", content: "hi" }],
    });
    throw new Error("expected insufficient credits error");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Chat result: ${msg}`);
    if (!msg.includes("insufficient")) {
      throw err;
    }
  }

  console.log("Node SIWx E2E PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
