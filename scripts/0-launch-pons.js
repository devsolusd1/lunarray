// Step 2 done from here instead of the Pons website: launch the token on Pons v2 with logo, description, website and
// socials written ON-CHAIN in the launch itself (the Pons site reads them back from the token contract).
//
//   DRY_RUN=1 npx hardhat run scripts/0-launch-pons.js --network robinhood   simulates: prints fee, predicted token/curve, gas. Sends nothing.
//   npx hardhat run scripts/0-launch-pons.js --network robinhood             sends the launch with DEPLOYER_PK
//
// .env (see .env.example):
//   SPLITTER            FeeSplitter address from step 1 (becomes creatorFeeRecipient, immutable)
//   CREATOR_TAX_BPS     500 = 5%  (capped by the factory's maxCreatorTaxBps)
//   LAUNCH_NAME / LAUNCH_SYMBOL / LAUNCH_LOGO (ipfs://CID like the Pons site stores, or an https url) / LAUNCH_DESCRIPTION
//   LAUNCH_WEBSITE / LAUNCH_TWITTER / LAUNCH_TELEGRAM / LAUNCH_DISCORD / LAUNCH_FARCASTER   (any can be empty)
//   DEV_BUY_ETH         optional first buy in the same tx (snipe-tax exempt), e.g. 0.02
//   SNIPE_EXEMPT        optional comma-separated extra wallets exempt from the opening snipe tax (max 32)
//   LAUNCH_CONFIG_ID    0 (the only config today: 1B supply, 1% curve fee, 1.68 ETH phantom, graduates at 4.2 ETH)
//   LAUNCH_SALT         optional 0x + 64 hex to reproduce a predicted address; random otherwise
//   LAUNCH_FROM         DRY_RUN only: simulate as this address instead of the signer
const { ethers, network } = require("hardhat");
const A = require("./addresses");

const PARAMS_T = "(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)";
const FACTORY_ABI = [
  "function launchEnabled() view returns (bool)",
  "function launchFee() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  `function launchToken(${PARAMS_T} params, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions) payable returns (address token, address curve)`,
  "function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))",
  "event TokenLaunched(address token, address curve, address deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
];
const ROUTER_ABI = [
  `function launchAndBuy(${PARAMS_T} params, uint256 launchConfigId, address pairToken, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions) payable returns (address token, address curve, uint256 tokensOut)`,
];
const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function logo() view returns (string)",
  "function description() view returns (string)",
  "function socials() view returns (string twitter,string telegram,string discord,string website,string farcaster)",
];

const env = (k, d = "") => (process.env[k] ?? d).trim();
const fmt = (v) => ethers.formatEther(v) + " ETH";

async function main() {
  const cfg = A[network.config.chainId];
  if (!cfg?.PONS_FACTORY || !cfg?.PONS_LAUNCH_AND_BUY) throw new Error("no Pons addresses for this chain");
  const dry = !!env("DRY_RUN");
  const splitter = env("SPLITTER");
  if (!ethers.isAddress(splitter)) throw new Error("set SPLITTER=0x... (deploy it first: scripts/1-deploy-splitter.js)");
  const name = env("LAUNCH_NAME"), symbol = env("LAUNCH_SYMBOL");
  if (!name || !symbol) throw new Error("set LAUNCH_NAME and LAUNCH_SYMBOL");
  const taxBps = Number(env("CREATOR_TAX_BPS", "500"));
  const configId = BigInt(env("LAUNCH_CONFIG_ID", "0"));
  const devBuy = ethers.parseEther(env("DEV_BUY_ETH", "0") || "0");
  const exempt = env("SNIPE_EXEMPT").split(",").map((s) => s.trim()).filter(Boolean);
  for (const a of exempt) if (!ethers.isAddress(a)) throw new Error("bad SNIPE_EXEMPT address: " + a);
  if (exempt.length > 32) throw new Error("max 32 snipe exemptions");
  const salt = env("LAUNCH_SALT") || ethers.hexlify(ethers.randomBytes(32));
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt)) throw new Error("LAUNCH_SALT must be 0x + 64 hex");

  const provider = ethers.provider;
  const signers = await ethers.getSigners();
  const from = dry ? (env("LAUNCH_FROM") || signers[0]?.address) : signers[0]?.address;
  if (!from) throw new Error(dry ? "set LAUNCH_FROM=0x... or DEPLOYER_PK for the simulation" : "set DEPLOYER_PK in .env");
  const factory = new ethers.Contract(cfg.PONS_FACTORY, FACTORY_ABI, provider);
  const router = new ethers.Contract(cfg.PONS_LAUNCH_AND_BUY, ROUTER_ABI, provider);

  // ---- factory state and the terms we are pinning
  const [enabled, fee, maxTax, count] = await Promise.all([factory.launchEnabled(), factory.launchFee(), factory.maxCreatorTaxBps(), factory.launchConfigCount()]);
  if (!enabled) throw new Error("Pons launches are disabled right now (launchEnabled = false)");
  if (BigInt(taxBps) > maxTax) throw new Error(`CREATOR_TAX_BPS ${taxBps} above the factory max ${maxTax}`);
  if (configId >= count) throw new Error(`LAUNCH_CONFIG_ID ${configId} does not exist (count ${count})`);
  const lc = await factory.getLaunchConfig(configId);
  if (!lc.enabled) throw new Error("that launch config is disabled");
  const expectedEconomics = await factory.previewLaunchEconomics(configId, ethers.ZeroAddress);
  console.log(`factory ${cfg.PONS_FACTORY} | launch fee ${fmt(fee)} | max creator tax ${maxTax} bps`);
  console.log(`config #${configId}: supply ${ethers.formatEther(lc.supply)} | curve fee ${lc.curveFeeBps} bps | phantom ${fmt(lc.phantomQuote)} | graduates at ${fmt(lc.graduationThreshold)} | pool fee ${lc.poolFee} tick ${lc.tickSpacing}`);

  const params = {
    name, symbol,
    logo: env("LAUNCH_LOGO"),
    description: env("LAUNCH_DESCRIPTION"),
    socials: { twitter: env("LAUNCH_TWITTER"), telegram: env("LAUNCH_TELEGRAM"), discord: env("LAUNCH_DISCORD"), website: env("LAUNCH_WEBSITE"), farcaster: env("LAUNCH_FARCASTER") },
    creatorFeeRecipient: splitter,
    creatorTaxBps: taxBps,
    buybackEnabled: false, // the Pons buyback vault is off: LUNARRAY's own engine does the buybacks
    expectedEconomics,
    salt,
  };
  console.log("params:", JSON.stringify({ ...params, expectedEconomics: expectedEconomics.slice(0, 10) + "…", salt: salt.slice(0, 10) + "…" }, null, 2));
  for (const [k, v] of Object.entries({ logo: params.logo, website: params.socials.website })) if (v && !/^https?:\/\//.test(v) && !/^ipfs:\/\//.test(v)) console.warn(`WARNING: ${k} is not an http(s)/ipfs url: ${v}`);
  if (!params.logo) console.warn("WARNING: no LAUNCH_LOGO: the token will have no image on Pons (immutable after launch)");

  // ---- build the call: launchAndBuy when there is a dev buy, plain launchToken otherwise
  const useRouter = devBuy > 0n;
  const value = fee + (useRouter ? devBuy : 0n);
  const target = useRouter ? router : factory;
  const data = useRouter
    ? router.interface.encodeFunctionData("launchAndBuy", [params, configId, ethers.ZeroAddress, devBuy, 0n, from, exempt])
    : factory.interface.encodeFunctionData("launchToken", [params, configId, ethers.ZeroAddress, exempt]);
  console.log(`\n${useRouter ? "launchAndBuy via router " + cfg.PONS_LAUNCH_AND_BUY : "launchToken on the factory"} | msg.value ${fmt(value)}${useRouter ? ` (fee ${fmt(fee)} + dev buy ${fmt(devBuy)})` : ""} | from ${from}`);

  const bal = await provider.getBalance(from);
  if (bal < value) console.warn(`WARNING: ${from} holds ${fmt(bal)}, below msg.value ${fmt(value)} (gas on top)`);

  // ---- simulate first, always (in DRY_RUN an unfunded LAUNCH_FROM is given a pretend balance via state override)
  const to = await target.getAddress();
  const hex = (n) => "0x" + BigInt(n).toString(16);
  const callObj = { to, from, data, value: hex(value) };
  const override = dry && bal < value + ethers.parseEther("0.01") ? { [from]: { balance: hex(value + ethers.parseEther("1")) } } : null;
  if (override) console.log("(DRY_RUN: simulating with a pretend balance for", from + ")");
  const ret = override ? await provider.send("eth_call", [callObj, "latest", override]) : await provider.call({ to, from, data, value });
  const out = target.interface.decodeFunctionResult(useRouter ? "launchAndBuy" : "launchToken", ret);
  console.log(`simulation ok: token ${out.token} | curve ${out.curve}${useRouter ? ` | dev buy gets ${ethers.formatEther(out.tokensOut)} tokens` : ""}`);
  let gas = null;
  try {
    gas = BigInt(override ? await provider.send("eth_estimateGas", [callObj, "latest", override]) : await provider.estimateGas({ to, from, data, value }));
    console.log("gas estimate:", gas.toString());
  } catch (e) { console.warn("gas estimate failed:", e.shortMessage || e.message); }
  if (dry) { console.log("\nDRY_RUN: nothing sent. Same salt reproduces the same addresses: LAUNCH_SALT=" + salt); return; }

  // ---- send
  const signer = signers[0];
  const tx = await signer.sendTransaction({ to, data, value, ...(gas ? { gasLimit: (gas * 12n) / 10n } : {}) });
  console.log("sent", tx.hash);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } }).find((e) => e && e.name === "TokenLaunched");
  const token = ev ? ev.args.token : out.token, curve = ev ? ev.args.curve : out.curve;
  console.log(`\nLAUNCHED  token ${token}\n          curve ${curve}\n          block ${rc.blockNumber} gas ${rc.gasUsed}`);

  // ---- read back what Pons will show
  const L = await factory.getLaunchedToken(token);
  const t = new ethers.Contract(token, TOKEN_ABI, provider);
  const [n, s, logo, desc, soc] = await Promise.all([t.name(), t.symbol(), t.logo().catch(() => "?"), t.description().catch(() => "?"), t.socials().catch(() => null)]);
  console.log(`on-chain: ${n} (${s}) | logo ${logo} | description ${desc}`);
  if (soc) console.log(`socials: website ${soc.website || "-"} | x ${soc.twitter || "-"} | telegram ${soc.telegram || "-"} | discord ${soc.discord || "-"} | farcaster ${soc.farcaster || "-"}`);
  console.log(`fee recipient ${L.creatorFeeRecipient} ${L.creatorFeeRecipient.toLowerCase() === splitter.toLowerCase() ? "(= FeeSplitter, ok)" : "(!! not the splitter)"} | creator tax ${L.creatorTaxBps} bps`);
  console.log(`\nnext: TOKEN=${token} in .env, then  npx hardhat run scripts/2-deploy-engine.js --network robinhood`);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
