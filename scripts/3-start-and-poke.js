// Step 3: keeper. Starts the engine as soon as there is a live market (the Pons curve right after launch), then
// runs one poke() per epoch. Also harvests the splitter, settles matured bonds and, if the graduating buy failed
// to create the pool, pushes graduation forward (permissionless on the Pons factory).
//   ENGINE=0x... SPLITTER=0x... npx hardhat run scripts/3-start-and-poke.js --network robinhood          (one shot)
//   ENGINE=0x... SPLITTER=0x... LOOP=1 npx hardhat run scripts/3-start-and-poke.js --network robinhood   (keeps running)
// Anyone can call poke(); the caller receives a small ETH tip from the reserve.
const { ethers, network } = require("hardhat");
const A = require("./addresses");

const CURVE_ABI = ["function readyToGraduate() view returns (bool)", "function graduated() view returns (bool)"];
const FACTORY_ABI = ["function createGraduatedPool(address token)"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

async function tick(engine, splitter, pons) {
  if (splitter) {
    const pending = await splitter.pending();
    if (pending > 0n) {
      const tx = await splitter.harvest();
      await tx.wait();
      console.log(now(), "harvested", ethers.formatEther(pending), "ETH from the Pons escrow");
    }
  }
  if (pons) {
    const [ready, graduated] = await Promise.all([pons.curve.readyToGraduate(), pons.curve.graduated()]);
    if (ready && !graduated) {
      console.log(now(), "curve is full but no pool yet: calling factory.createGraduatedPool()");
      const tx = await pons.factory.createGraduatedPool(pons.token);
      await tx.wait();
    }
  }
  if (!(await engine.started())) {
    if ((await engine.spot()) === 0n) return console.log(now(), "no live market yet (curve not found and pool not initialized)");
    const tx = await engine.start();
    await tx.wait();
    return console.log(now(), "engine started on", Number(await engine.priceSource()) === 1 ? "the Pons curve" : "the Uniswap v4 pool");
  }
  const last = await engine.lastSampleAt();
  const len = await engine.epochLength();
  const ts = BigInt(Math.floor(Date.now() / 1000));
  if (ts < last + len) return console.log(now(), `epoch not over (${Number(last + len - ts)}s left)`);
  const tx = await engine.poke();
  const rc = await tx.wait();
  console.log(now(), "poked epoch", (await engine.epoch()).toString(), "| source", Number(await engine.priceSource()) === 1 ? "curve" : "pool", "| gas", rc.gasUsed.toString());
  const settled = await engine.settle.staticCall(20);
  if (settled > 0n) {
    const t2 = await engine.settle(20);
    await t2.wait();
    console.log("  settled", settled.toString(), "bonds");
  }
}

async function main() {
  if (!process.env.ENGINE) throw new Error("set ENGINE=0x... in .env");
  const engine = await ethers.getContractAt("BondEngine", process.env.ENGINE);
  const splitter = process.env.SPLITTER ? await ethers.getContractAt("FeeSplitter", process.env.SPLITTER) : null;
  const cfg = A[network.config.chainId] || {};
  const curveAddr = await engine.curve();
  const [signer] = await ethers.getSigners();
  const pons = curveAddr !== ethers.ZeroAddress && cfg.PONS_FACTORY
    ? { token: await engine.token(), curve: new ethers.Contract(curveAddr, CURVE_ABI, ethers.provider), factory: new ethers.Contract(cfg.PONS_FACTORY, FACTORY_ABI, signer) }
    : null;
  console.log(now(), "keeper", signer.address, "| engine", process.env.ENGINE, "| curve", curveAddr);
  do {
    try { await tick(engine, splitter, pons); } catch (e) { console.error(now(), "tick failed:", e.shortMessage || e.message); }
    if (process.env.LOOP) await sleep(60_000);
  } while (process.env.LOOP);
}
main().catch((e) => { console.error(e); process.exit(1); });
