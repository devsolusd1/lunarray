// Step 2 (right AFTER the Pons launch, token address known): deploy the BondEngine and wire the splitter.
// The engine reads the launch record from the Pons factory (curve, pool fee, tick spacing) and is live from the
// bonding curve on: no need to wait for graduation. The treasury is read from the FeeSplitter.
//   TOKEN=0xPonsToken GUARDIAN=0xColdWallet SPLITTER=0xFeeSplitter npx hardhat run scripts/2-deploy-engine.js --network robinhood
const { ethers, network, run } = require("hardhat");
const A = require("./addresses");

const FACTORY_ABI = ["function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))"];

async function main() {
  const cfg = A[network.config.chainId];
  const { TOKEN, GUARDIAN, SPLITTER } = process.env;
  for (const [k, v] of Object.entries({ TOKEN, GUARDIAN, SPLITTER })) if (!v || !ethers.isAddress(v)) throw new Error(`set ${k}=0x... in .env`);
  const params = A.DEFAULT_PARAMS;
  const [deployer] = await ethers.getSigners();
  console.log("deployer:", deployer.address, "| chain:", network.config.chainId);

  const splitter = await ethers.getContractAt("FeeSplitter", SPLITTER);
  const treasury = await splitter.treasury();
  console.log("treasury (from FeeSplitter):", treasury, "| treasuryBps:", (await splitter.treasuryBps()).toString());

  let curve = ethers.ZeroAddress, poolFee = cfg.POOL_FEE, tickSpacing = cfg.TICK_SPACING;
  if (cfg.PONS_FACTORY) {
    const factory = new ethers.Contract(cfg.PONS_FACTORY, FACTORY_ABI, ethers.provider);
    const L = await factory.getLaunchedToken(TOKEN);
    if (!L.exists) throw new Error("TOKEN is not a Pons v2 launch on this chain");
    if (L.pairToken !== ethers.ZeroAddress) throw new Error("the engine supports ETH-paired launches only (pairToken must be ETH)");
    if (L.creatorFeeRecipient.toLowerCase() !== SPLITTER.toLowerCase()) console.warn("WARNING: creatorFeeRecipient on Pons is", L.creatorFeeRecipient, "and not the FeeSplitter");
    curve = L.curve; poolFee = Number(L.poolFee); tickSpacing = Number(L.tickSpacing);
    console.log("pons launch: curve", curve, "| creatorTaxBps", L.creatorTaxBps.toString(), "| phase", L.phase.toString(), "| poolFee", poolFee, "| tickSpacing", tickSpacing);
  }

  const Engine = await ethers.getContractFactory("BondEngine");
  const args = [TOKEN, curve, cfg.UNISWAP_V4_POOL_MANAGER, cfg.UNISWAP_V4_STATE_VIEW, cfg.PONS_MEME_HOOK, poolFee, tickSpacing, GUARDIAN, treasury, A.EPOCH_LENGTH, params];
  const e = await Engine.deploy(...args);
  await e.waitForDeployment();
  const addr = await e.getAddress();
  console.log("BondEngine:", addr, "| poolId:", await e.poolId());
  if ((await splitter.protocol()) === ethers.ZeroAddress) {
    const tx = await splitter.setProtocol(addr);
    await tx.wait();
    console.log("FeeSplitter.protocol set ->", addr);
  }
  const src = Number(await e.priceSource());
  const spot = await e.spot();
  console.log(src === 1 ? "market live on the Pons curve" : src === 2 ? "market live on the Uniswap v4 pool" : "no live market yet",
    "| spot tokens/ETH:", spot > 0n ? Number(spot * 1000000n / (1n << 96n)) / 1e6 : "-");
  console.log(spot > 0n ? "run the keeper now: it calls start() and then poke() every epoch (scripts/3-start-and-poke.js)" : "call start() once a market exists (keeper does it)");
  if (process.env.VERIFY) {
    await new Promise((r) => setTimeout(r, 15000));
    await run("verify:verify", { address: addr, constructorArguments: args });
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
