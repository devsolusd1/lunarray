const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const Q96 = 1n << 96n;
const sqrtP = (tokensPerEthSqrt) => BigInt(tokensPerEthSqrt) * Q96; // sqrt(tokens per ETH) * 2^96
const HOUR = 3600;
const DAY = 24 * HOUR;

const PARAMS = {
  maxBonusBps: 5000,
  bandBps: 5000,
  entryBurnBps: 100,
  penaltyBps: 2000,
  releaseBps: 1000,
  stakingShareBps: 5000,
  window: 24,
  vestEpochs: 3,
  minSamples: 2,
};

// curve = address(0): pool-only engine (same behaviour as before the curve phase existed)
async function deployAll(withCurve = false) {
  const [deployer, guardian, treasury, alice, bob, keeper] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockERC20");
  const token = await Token.deploy();
  const SV = await ethers.getContractFactory("MockStateView");
  const stateView = await SV.deploy();
  const PM = await ethers.getContractFactory("MockPoolManager");
  const pm = await PM.deploy(await token.getAddress(), ethers.parseEther("1000000")); // 1M tokens per ETH
  await token.mint(await pm.getAddress(), ethers.parseEther("500000000")); // pool inventory
  let curve = null;
  if (withCurve) {
    // pricing reserves 1 ETH : 1M tokens -> 1M tokens per ETH, 0.5 ETH of capacity left before graduation
    const Curve = await ethers.getContractFactory("MockCurve");
    curve = await Curve.deploy(await token.getAddress(), ethers.parseEther("1000000"), ethers.parseEther("1"), ethers.parseEther("1000000"), ethers.parseEther("0.5"));
    await token.mint(await curve.getAddress(), ethers.parseEther("500000000"));
  }
  const Engine = await ethers.getContractFactory("BondEngine");
  const engine = await Engine.deploy(
    await token.getAddress(), curve ? await curve.getAddress() : ethers.ZeroAddress, await pm.getAddress(), await stateView.getAddress(),
    ethers.ZeroAddress, 0, 200, guardian.address, treasury.address, HOUR, PARAMS
  );
  const Escrow = await ethers.getContractFactory("MockEscrow");
  const escrow = await Escrow.deploy();
  const Splitter = await ethers.getContractFactory("FeeSplitter");
  const splitter = await Splitter.deploy(await escrow.getAddress(), treasury.address, 6000);
  await splitter.setProtocol(await engine.getAddress());
  for (const u of [alice, bob]) await token.mint(u.address, ethers.parseEther("10000000"));
  return { deployer, guardian, treasury, alice, bob, keeper, token, stateView, pm, curve, engine, escrow, splitter };
}

async function warmup(ctx, samples = PARAMS.minSamples) {
  await ctx.stateView.set(sqrtP(1000)); // 1M tokens per ETH
  await ctx.engine.start();
  for (let i = 1; i < samples; i++) {
    await time.increase(HOUR);
    await ctx.engine.poke();
  }
}

const eventsOf = (engine, rc, name) => rc.logs.map((l) => { try { return engine.interface.parseLog(l); } catch { return null; } }).filter((e) => e && e.name === name);

describe("FeeSplitter", () => {
  it("splits 60/40 between treasury and protocol, permissionlessly (creator tax 5% = 3% + 2%)", async () => {
    const c = await deployAll();
    await c.escrow.credit(await c.splitter.getAddress(), { value: ethers.parseEther("10") });
    expect(await c.splitter.pending()).to.equal(ethers.parseEther("10"));
    const before = await ethers.provider.getBalance(c.treasury.address);
    await c.splitter.connect(c.keeper).harvest();
    const after = await ethers.provider.getBalance(c.treasury.address);
    expect(after - before).to.equal(ethers.parseEther("6"));
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("4")); // no stakers yet -> all to reserve
    expect(await c.splitter.totalToProtocol()).to.equal(ethers.parseEther("4"));
  });

  it("protocol can be set only once and only by deployer", async () => {
    const c = await deployAll();
    await expect(c.splitter.setProtocol(c.alice.address)).to.be.revertedWithCustomError(c.splitter, "AlreadySet");
    const Splitter = await ethers.getContractFactory("FeeSplitter");
    const s2 = await Splitter.deploy(await c.escrow.getAddress(), c.treasury.address, 6000);
    await expect(s2.connect(c.alice).setProtocol(c.alice.address)).to.be.revertedWithCustomError(s2, "NotDeployer");
    await expect(s2.harvest()).to.be.revertedWithCustomError(s2, "ProtocolNotSet");
  });
});

describe("BondEngine (pool)", () => {
  it("computes poolId like Uniswap v4 (REVENANT pool on Robinhood Chain)", async () => {
    const Engine = await ethers.getContractFactory("BondEngine");
    const [, guardian, treasury] = await ethers.getSigners();
    const e = await Engine.deploy(
      "0x848d3FC2660084b32971c1F58Ae46103d2B324AC", ethers.ZeroAddress, ethers.ZeroAddress, ethers.ZeroAddress,
      "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044", 0, 200, guardian.address, treasury.address, HOUR, PARAMS
    );
    expect(await e.poolId()).to.equal("0x6f97f95759ffcce8a2b3f0b666dde8e05cbd895712245b5a5708c2603bd9105d");
  });

  it("does not start before there is a live market", async () => {
    const c = await deployAll();
    expect(await c.engine.priceSource()).to.equal(0);
    await expect(c.engine.start()).to.be.revertedWithCustomError(c.engine, "MarketNotLive");
    await c.stateView.set(sqrtP(1000));
    expect(await c.engine.priceSource()).to.equal(2);
    await c.engine.start();
    expect(await c.engine.started()).to.equal(true);
    expect(await c.engine.spot()).to.equal(1000000n * Q96);
    await expect(c.engine.poke()).to.be.revertedWithCustomError(c.engine, "EpochNotOver");
  });

  it("bonus grows with the discount to target and bonds pay out FIFO after vesting", async () => {
    const c = await deployAll();
    await warmup(c, 3);
    expect(await c.engine.discountBps()).to.equal(0);
    await expect(c.engine.connect(c.alice).bond(1n, 0)).to.be.revertedWithCustomError(c.engine, "NoDiscount");

    // price drops: 1.5625M tokens per ETH  -> discount = 1 - 1/1.5625 = 36%
    await c.stateView.set(sqrtP(1250));
    expect(await c.engine.discountBps()).to.equal(3600);
    expect(await c.engine.bonusBps()).to.equal(3600);

    const amt = ethers.parseEther("1000000");
    await c.token.connect(c.alice).approve(await c.engine.getAddress(), amt);
    await expect(c.engine.connect(c.alice).bond(amt, 3700)).to.be.revertedWithCustomError(c.engine, "BonusTooLow");
    await c.engine.connect(c.alice).bond(amt, 3500);
    const b = await c.engine.bonds(0);
    const principal = amt - amt / 100n; // 1% burned
    expect(b.principal).to.equal(principal);
    expect(b.payout).to.equal((principal * 13600n) / 10000n);
    expect(await c.token.balanceOf("0x000000000000000000000000000000000000dEaD")).to.equal(amt / 100n);
    expect(await c.engine.crypt()).to.equal(principal);
    expect(await c.engine.idleFor()).to.equal(0); // a bond is outstanding

    // not matured yet: settle pays nothing
    await c.engine.settle(10);
    expect(await c.engine.queueHead()).to.equal(0);

    // fund the crypt through buybacks: 4 ETH reserve, 10% per epoch at 1M tokens/ETH = 400k tokens/epoch
    await c.deployer.sendTransaction({ to: await c.engine.getAddress(), value: ethers.parseEther("4") });
    for (let i = 0; i < 3; i++) { await time.increase(HOUR); await c.engine.connect(c.keeper).poke(); }
    expect(await c.engine.totalBoughtBack()).to.be.gt(ethers.parseEther("1000000"));

    const before = await c.token.balanceOf(c.alice.address);
    await c.engine.settle(10);
    const after = await c.token.balanceOf(c.alice.address);
    expect(after - before).to.equal(b.payout);
    expect(await c.engine.queueHead()).to.equal(1);
    expect(await c.engine.bondedOutstanding()).to.equal(0);
  });

  it("exit before maturity refunds principal minus 20% penalty", async () => {
    const c = await deployAll();
    await warmup(c, 3);
    await c.stateView.set(sqrtP(1250));
    const amt = ethers.parseEther("1000");
    await c.token.connect(c.bob).approve(await c.engine.getAddress(), amt);
    await c.engine.connect(c.bob).bond(amt, 0);
    const principal = amt - amt / 100n;
    const before = await c.token.balanceOf(c.bob.address);
    await c.engine.connect(c.bob).exit(0);
    expect((await c.token.balanceOf(c.bob.address)) - before).to.equal((principal * 8000n) / 10000n);
    expect(await c.engine.crypt()).to.equal((principal * 2000n) / 10000n); // penalty stays
    await expect(c.engine.connect(c.bob).exit(0)).to.be.revertedWithCustomError(c.engine, "BondClosed");
    await expect(c.engine.connect(c.alice).exit(0)).to.be.revertedWithCustomError(c.engine, "NotOwner");
  });

  it("stakers earn ETH pro-rata from the protocol share", async () => {
    const c = await deployAll();
    await warmup(c);
    const eng = await c.engine.getAddress();
    await c.token.connect(c.alice).approve(eng, ethers.parseEther("300"));
    await c.token.connect(c.bob).approve(eng, ethers.parseEther("100"));
    await c.engine.connect(c.alice).stake(ethers.parseEther("300"));
    await c.engine.connect(c.bob).stake(ethers.parseEther("100"));
    // 4 ETH arrives (the 40% of a 10 ETH harvest): 50% to stakers, 50% to reserve
    await c.escrow.credit(await c.splitter.getAddress(), { value: ethers.parseEther("10") });
    await c.splitter.harvest();
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("2"));
    expect(await c.engine.earned(c.alice.address)).to.equal(ethers.parseEther("1.5"));
    expect(await c.engine.earned(c.bob.address)).to.equal(ethers.parseEther("0.5"));
    const before = await ethers.provider.getBalance(c.bob.address);
    const tx = await c.engine.connect(c.bob).claimRewards();
    const rc = await tx.wait();
    const gas = rc.gasUsed * rc.gasPrice;
    expect((await ethers.provider.getBalance(c.bob.address)) - before + gas).to.equal(ethers.parseEther("0.5"));
    await c.engine.connect(c.bob).unstake(ethers.parseEther("100"));
    expect(await c.engine.staked(c.bob.address)).to.equal(0);
    // the keeper tip comes out of the reserve
    await time.increase(HOUR);
    const kb = await ethers.provider.getBalance(c.keeper.address);
    const ptx = await c.engine.connect(c.keeper).poke();
    const prc = await ptx.wait();
    expect((await ethers.provider.getBalance(c.keeper.address)) - kb + prc.gasUsed * prc.gasPrice).to.be.gt(0);
  });

  it("pause blocks only new entries, expires alone, and params are timelocked", async () => {
    const c = await deployAll();
    await warmup(c, 3);
    await c.stateView.set(sqrtP(1250));
    const eng = await c.engine.getAddress();
    await c.token.connect(c.alice).approve(eng, ethers.parseEther("1000"));
    await c.engine.connect(c.alice).stake(ethers.parseEther("500"));
    await expect(c.engine.connect(c.alice).pause(3600)).to.be.revertedWithCustomError(c.engine, "NotGuardian");
    await expect(c.engine.connect(c.guardian).pause(8 * DAY)).to.be.revertedWithCustomError(c.engine, "PauseTooLong");
    await c.engine.connect(c.guardian).pause(2 * HOUR);
    expect(await c.engine.isPaused()).to.equal(true);
    await expect(c.engine.connect(c.alice).stake(1n)).to.be.revertedWithCustomError(c.engine, "EntriesPaused");
    await expect(c.engine.connect(c.alice).bond(1n, 0)).to.be.revertedWithCustomError(c.engine, "EntriesPaused");
    await c.engine.connect(c.alice).unstake(ethers.parseEther("500")); // never blocked
    await time.increase(HOUR); await c.engine.poke();                    // never blocked
    await time.increase(2 * HOUR);
    expect(await c.engine.isPaused()).to.equal(false);

    const p = { ...PARAMS, maxBonusBps: 2000 };
    await expect(c.engine.connect(c.alice).proposeParams(p)).to.be.revertedWithCustomError(c.engine, "NotGuardian");
    await c.engine.connect(c.guardian).proposeParams(p);
    await expect(c.engine.executeParams()).to.be.revertedWithCustomError(c.engine, "TooEarly");
    await time.increase(48 * HOUR);
    await c.engine.executeParams();
    expect((await c.engine.params()).maxBonusBps).to.equal(2000);
    await expect(c.engine.connect(c.guardian).proposeParams({ ...PARAMS, bandBps: 0 })).to.be.revertedWithCustomError(c.engine, "BadParams");
  });

  it("sweepIdle sends idle crypt + reserve to the treasury only after 30 days without bonds; stakers untouched", async () => {
    const c = await deployAll();
    await warmup(c, 3);
    const eng = await c.engine.getAddress();
    // alice stakes, then 4 ETH arrives: 2 ETH owed to alice, 2 ETH in the reserve
    await c.token.connect(c.alice).approve(eng, ethers.MaxUint256);
    await c.engine.connect(c.alice).stake(ethers.parseEther("1000"));
    await c.deployer.sendTransaction({ to: eng, value: ethers.parseEther("4") });
    await time.increase(HOUR); await c.engine.poke(); // buyback fills the crypt
    expect(await c.engine.crypt()).to.be.gt(0);
    expect(await c.engine.earned(c.alice.address)).to.equal(ethers.parseEther("2"));

    await expect(c.engine.connect(c.alice).sweepIdle()).to.be.revertedWithCustomError(c.engine, "NotGuardian");
    await expect(c.engine.connect(c.guardian).sweepIdle()).to.be.revertedWithCustomError(c.engine, "NotIdle"); // < 30 days since deploy

    // an outstanding bond blocks the sweep even after 30 days
    await c.stateView.set(sqrtP(1250));
    await c.engine.connect(c.alice).bond(ethers.parseEther("1000"), 0);
    await time.increase(30 * DAY);
    expect(await c.engine.idleFor()).to.equal(0);
    await expect(c.engine.connect(c.guardian).sweepIdle()).to.be.revertedWithCustomError(c.engine, "NotIdle");
    // bond matures and is paid: the idle clock restarts from the settlement
    await c.stateView.set(sqrtP(1000));
    for (let i = 0; i < 3; i++) { await time.increase(HOUR); await c.engine.poke(); }
    await c.engine.settle(10);
    expect(await c.engine.bondedOutstanding()).to.equal(0);
    await expect(c.engine.connect(c.guardian).sweepIdle()).to.be.revertedWithCustomError(c.engine, "NotIdle");
    await time.increase(30 * DAY);
    expect(await c.engine.idleFor()).to.be.gte(30 * DAY);

    const crypt = await c.engine.crypt();
    const reserve = await c.engine.ethReserve();
    const tBefore = await ethers.provider.getBalance(c.treasury.address);
    const tTok = await c.token.balanceOf(c.treasury.address);
    await c.engine.connect(c.guardian).sweepIdle();
    expect(await c.engine.crypt()).to.equal(0);
    expect(await c.engine.ethReserve()).to.equal(0);
    expect((await ethers.provider.getBalance(c.treasury.address)) - tBefore).to.equal(reserve);
    expect((await c.token.balanceOf(c.treasury.address)) - tTok).to.equal(crypt);
    // alice's stake and ETH are intact and still claimable
    expect(await c.engine.staked(c.alice.address)).to.equal(ethers.parseEther("1000"));
    expect(await c.engine.earned(c.alice.address)).to.equal(ethers.parseEther("2"));
    expect(await ethers.provider.getBalance(eng)).to.equal(ethers.parseEther("2"));
    await c.engine.connect(c.alice).claimRewards();
    await c.engine.connect(c.alice).unstake(ethers.parseEther("1000"));
    expect(await ethers.provider.getBalance(eng)).to.equal(0);
  });
});

describe("BondEngine on the Pons curve (before graduation)", () => {
  it("starts on the curve, samples its price and buys back through curve.buy", async () => {
    const c = await deployAll(true);
    expect(await c.engine.onCurve()).to.equal(true);
    expect(await c.engine.priceSource()).to.equal(1);
    expect(await c.engine.spot()).to.equal(1000000n * Q96); // 1M tokens / 1 ETH pricing reserves
    await c.engine.start();
    expect(await c.engine.sampleCount()).to.equal(1);
    const eng = await c.engine.getAddress();
    await c.deployer.sendTransaction({ to: eng, value: ethers.parseEther("4") });
    await time.increase(HOUR);
    const rc = await (await c.engine.connect(c.keeper).poke()).wait();
    const [bb] = eventsOf(c.engine, rc, "Buyback");
    expect(bb.args.ethIn).to.equal(ethers.parseEther("0.4"));
    expect(bb.args.tokensOut).to.equal(ethers.parseEther("400000"));
    expect(bb.args.source).to.equal(1);
    expect(await c.engine.crypt()).to.equal(ethers.parseEther("400000"));
    expect(await c.token.balanceOf(eng)).to.equal(ethers.parseEther("400000"));
    const tip = ethers.parseEther("3.6") / 1000n; // 0.1% of the reserve after the buy, below the cap
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("3.6") - tip);
    expect(await ethers.provider.getBalance(eng)).to.equal(await c.engine.ethReserve());
  });

  it("a partially filled curve buy refunds the rest to the reserve", async () => {
    const c = await deployAll(true);
    await c.curve.setCapacity(ethers.parseEther("0.1"));
    await c.engine.start();
    const eng = await c.engine.getAddress();
    await c.deployer.sendTransaction({ to: eng, value: ethers.parseEther("4") });
    await time.increase(HOUR);
    const rc = await (await c.engine.poke()).wait();
    const [bb] = eventsOf(c.engine, rc, "Buyback");
    expect(bb.args.ethIn).to.equal(ethers.parseEther("0.1"));   // only what the curve could sell
    expect(bb.args.tokensOut).to.equal(ethers.parseEther("100000"));
    const tip = ethers.parseEther("3.9") / 1000n;
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("3.9") - tip);
    expect(await ethers.provider.getBalance(eng)).to.equal(await c.engine.ethReserve()); // refund is in the balance
    expect(await c.curve.readyToGraduate()).to.equal(true);
  });

  it("a failing curve buy is skipped and the epoch still advances", async () => {
    const c = await deployAll(true);
    await c.engine.start();
    await c.curve.setFailing(true);
    const eng = await c.engine.getAddress();
    await c.deployer.sendTransaction({ to: eng, value: ethers.parseEther("4") });
    await time.increase(HOUR);
    const rc = await (await c.engine.poke()).wait();
    expect(eventsOf(c.engine, rc, "Buyback").length).to.equal(0);
    expect(eventsOf(c.engine, rc, "BuybackSkipped").length).to.equal(1);
    expect(await c.engine.epoch()).to.equal(1);
    expect(await c.engine.crypt()).to.equal(0);
    const tip = ethers.parseEther("4") / 1000n;
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("4") - tip);
  });

  it("switches to the v4 pool at graduation without a restart; ETH from the curve is not split as revenue", async () => {
    const c = await deployAll(true);
    await c.engine.start();
    const eng = await c.engine.getAddress();
    await c.token.connect(c.alice).approve(eng, ethers.MaxUint256);
    await c.engine.connect(c.alice).stake(ethers.parseEther("1000"));
    await c.curve.setCapacity(ethers.parseEther("0.1"));
    await c.deployer.sendTransaction({ to: eng, value: ethers.parseEther("4") }); // 2 to alice, 2 reserve
    await time.increase(HOUR);
    await c.engine.poke(); // 0.2 ETH buy, only 0.1 filled -> 0.1 refunded, must NOT reach alice as rewards
    expect(await c.engine.earned(c.alice.address)).to.equal(ethers.parseEther("2"));
    const tip1 = ethers.parseEther("1.9") / 1000n;
    expect(await c.engine.ethReserve()).to.equal(ethers.parseEther("1.9") - tip1);

    // graduation: the curve is done, the pool exists at the same price
    await c.curve.setGraduated(true);
    expect(await c.engine.priceSource()).to.equal(0);           // pool not initialized yet -> no market
    await expect(c.engine.poke()).to.be.revertedWithCustomError(c.engine, "EpochNotOver");
    await time.increase(HOUR);
    await expect(c.engine.poke()).to.be.revertedWithCustomError(c.engine, "MarketNotLive");
    await c.stateView.set(sqrtP(1000));
    expect(await c.engine.priceSource()).to.equal(2);
    expect(await c.engine.spot()).to.equal(1000000n * Q96);
    const rc = await (await c.engine.poke()).wait();
    const [bb] = eventsOf(c.engine, rc, "Buyback");
    expect(bb.args.source).to.equal(2);
    expect(bb.args.tokensOut).to.be.gt(0);
    expect(await c.engine.started()).to.equal(true);
    expect(await c.engine.sampleCount()).to.equal(3); // start + 2 pokes, one series across both markets
  });
});
