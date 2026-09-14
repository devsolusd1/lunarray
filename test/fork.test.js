// Run with:  FORK=1 npx hardhat test test/fork.test.js      (RH_RPC in .env, default rpc.ordofi.network)
// Exercises real buybacks on Robinhood Chain mainnet: on a live Pons v2 curve (pre-graduation) and on the
// Uniswap v4 pool of a graduated token (REVENANT), through the Pons MemeHook.
const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const A = require("../scripts/addresses");

const cfg = A[4663];
const REVENANT = "0x848d3FC2660084b32971c1F58Ae46103d2B324AC"; // graduated (v4 pool)
const ON_CURVE = process.env.CURVE_TOKEN || "0xcce4ee785574d906d53984bab6476cef7e5e033f"; // NADIR: still on its curve on 2026-09-14
const FACTORY_ABI = ["function getLaunchedToken(address) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))"];
const CURVE_ABI = ["function graduated() view returns (bool)", "function getReserves() view returns (uint256,uint256)"];

const PARAMS = { maxBonusBps: 5000, bandBps: 5000, entryBurnBps: 100, penaltyBps: 2000, releaseBps: 1000, stakingShareBps: 5000, window: 24, vestEpochs: 24, minSamples: 6 };

const buybackOf = (engine, rc) => rc.logs.map((l) => { try { return engine.interface.parseLog(l); } catch { return null; } }).filter(Boolean).find((e) => e.name === "Buyback");

async function deployFor(token) {
  await network.provider.send("evm_mine"); // move "latest" past the fork block so calls run on the local chain
  const [deployer, guardian, treasury] = await ethers.getSigners();
  const factory = new ethers.Contract(cfg.PONS_FACTORY, FACTORY_ABI, ethers.provider);
  const L = await factory.getLaunchedToken(token);
  expect(L.exists).to.equal(true);
  const Engine = await ethers.getContractFactory("BondEngine");
  const engine = await Engine.deploy(token, L.curve, cfg.UNISWAP_V4_POOL_MANAGER, cfg.UNISWAP_V4_STATE_VIEW, cfg.PONS_MEME_HOOK, L.poolFee, L.tickSpacing, guardian.address, treasury.address, 3600, PARAMS);
  await setBalance(deployer.address, ethers.parseEther("100"));
  return { deployer, engine, launch: L, curve: new ethers.Contract(L.curve, CURVE_ABI, ethers.provider) };
}

(process.env.FORK ? describe : describe.skip)("fork: Robinhood Chain mainnet", () => {
  it("buys on a live Pons curve before graduation (price from the curve reserves)", async function () {
    const { deployer, engine, curve } = await deployFor(ON_CURVE);
    if (await curve.graduated()) { console.log("    token already graduated, curve test skipped"); this.skip(); }
    expect(await engine.priceSource()).to.equal(1);
    const [q, t] = await curve.getReserves();
    const spot = await engine.spot();
    console.log("    curve spot tokens/ETH:", Number(spot * 1000000n / (1n << 96n)) / 1e6, "| reserves", ethers.formatEther(q), "ETH /", ethers.formatEther(t), "tokens");
    expect(spot).to.equal((t * (1n << 96n)) / q);
    await engine.start();
    await deployer.sendTransaction({ to: await engine.getAddress(), value: ethers.parseEther("0.1") });
    await time.increase(3600);
    const rc = await (await engine.poke()).wait();
    const ev = buybackOf(engine, rc);
    expect(ev, "Buyback event").to.not.equal(undefined);
    console.log("    curve buyback:", ethers.formatEther(ev.args.ethIn), "ETH ->", ethers.formatEther(ev.args.tokensOut), "tokens (source", ev.args.source.toString() + ")");
    expect(ev.args.source).to.equal(1);
    expect(ev.args.tokensOut).to.be.gt(0);
    const token = await ethers.getContractAt("MockERC20", ON_CURVE);
    expect(await token.balanceOf(await engine.getAddress())).to.equal(await engine.crypt());
    expect(await ethers.provider.getBalance(await engine.getAddress())).to.equal(await engine.ethReserve());
  });

  it("buys on the Uniswap v4 pool of a graduated token through the Pons hook", async () => {
    const { deployer, engine, curve } = await deployFor(REVENANT);
    expect(await curve.graduated()).to.equal(true);
    expect(await engine.priceSource()).to.equal(2);
    const spot = await engine.spot();
    console.log("    pool spot tokens/ETH:", Number(spot * 1000000n / (1n << 96n)) / 1e6);
    expect(spot).to.be.gt(0);
    await engine.start();
    await deployer.sendTransaction({ to: await engine.getAddress(), value: ethers.parseEther("0.1") });
    await time.increase(3600);
    const rc = await (await engine.poke()).wait();
    const ev = buybackOf(engine, rc);
    console.log("    pool buyback:", ethers.formatEther(ev.args.ethIn), "ETH ->", ethers.formatEther(ev.args.tokensOut), "REVENANT");
    expect(ev.args.source).to.equal(2);
    expect(ev.args.tokensOut).to.be.gt(0);
    const token = await ethers.getContractAt("MockERC20", REVENANT);
    expect(await token.balanceOf(await engine.getAddress())).to.equal(ev.args.tokensOut);
  });
});
