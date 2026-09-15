// Step 5: lock the dev wallet's tokens in a DevLock (time lock, beneficiary fixed, date can only be extended).
// Deploys the lock if DEVLOCK is not in .env, then approves and deposits from the dev wallet (DEPLOYER_PK).
//   DRY_RUN=1 npx hardhat run scripts/5-lock-dev-tokens.js --network robinhood   shows what would happen
//   npx hardhat run scripts/5-lock-dev-tokens.js --network robinhood             deploys (if needed) + locks
// .env:
//   TOKEN               the LUNARRAY token
//   LOCK_UNTIL          unlock date: ISO date (2027-03-15 or 2027-03-15T12:00:00Z) or a duration (+180d, +12m, +1y)
//   LOCK_BENEFICIARY    who can withdraw after the date (default: TREASURY, the cold wallet)
//   LOCK_AMOUNT         tokens to lock, in whole tokens (default: all of the dev wallet's balance)
//   DEVLOCK             existing lock address (skip the deploy and just deposit more)
const { ethers, network } = require("hardhat");

const env = (k, d = "") => (process.env[k] ?? d).trim();
const LOCK_ABI = ["function locked() view returns (uint256)", "function unlockAt() view returns (uint64)", "function beneficiary() view returns (address)", "function token() view returns (address)", "function deposit(uint256)"];

function parseUntil(s) {
  const m = s.match(/^\+(\d+)([dmy])$/i);
  if (m) {
    const n = Number(m[1]), u = m[2].toLowerCase();
    const d = new Date();
    if (u === "d") d.setUTCDate(d.getUTCDate() + n);
    if (u === "m") d.setUTCMonth(d.getUTCMonth() + n);
    if (u === "y") d.setUTCFullYear(d.getUTCFullYear() + n);
    return Math.floor(d.getTime() / 1000);
  }
  const t = Date.parse(s.length === 10 ? s + "T00:00:00Z" : s);
  if (Number.isNaN(t)) throw new Error("LOCK_UNTIL: use 2027-03-15, 2027-03-15T12:00:00Z, +180d, +12m or +1y");
  return Math.floor(t / 1000);
}

async function main() {
  const dry = !!env("DRY_RUN");
  const tokenAddr = env("TOKEN");
  if (!ethers.isAddress(tokenAddr)) throw new Error("set TOKEN=0x... in .env");
  const [dev] = await ethers.getSigners();
  if (!dev) throw new Error("set DEPLOYER_PK (the dev wallet) in .env");
  const token = await ethers.getContractAt("MockERC20", tokenAddr); // plain ERC-20 surface is enough
  const [symbol, decimals, supply, bal] = await Promise.all([token.symbol(), token.decimals(), token.totalSupply(), token.balanceOf(dev.address)]);
  const pct = (v) => (Number((v * 1000000n) / supply) / 10000).toFixed(2) + "%";
  console.log(`dev wallet ${dev.address} holds ${ethers.formatUnits(bal, decimals)} ${symbol} = ${pct(bal)} of supply | chain ${network.config.chainId}`);

  let lockAddr = env("DEVLOCK");
  let lock;
  if (lockAddr) {
    if (!ethers.isAddress(lockAddr)) throw new Error("DEVLOCK is not an address");
    lock = new ethers.Contract(lockAddr, LOCK_ABI, dev);
    if ((await lock.token()).toLowerCase() !== tokenAddr.toLowerCase()) throw new Error("DEVLOCK is for another token");
    console.log(`using existing DevLock ${lockAddr} | beneficiary ${await lock.beneficiary()} | unlocks ${new Date(Number(await lock.unlockAt()) * 1000).toISOString()} | locked ${ethers.formatUnits(await lock.locked(), decimals)}`);
  } else {
    const until = parseUntil(env("LOCK_UNTIL") || (() => { throw new Error("set LOCK_UNTIL (e.g. +180d or 2027-03-15)"); })());
    const beneficiary = env("LOCK_BENEFICIARY") || env("TREASURY");
    if (!ethers.isAddress(beneficiary)) throw new Error("set LOCK_BENEFICIARY or TREASURY");
    const days = ((until - Date.now() / 1000) / 86400).toFixed(1);
    console.log(`new DevLock: beneficiary ${beneficiary} | unlocks ${new Date(until * 1000).toISOString()} (${days} days)`);
    if (dry) { console.log("DRY_RUN: would deploy the lock and deposit", env("LOCK_AMOUNT") || "the whole balance"); return; }
    const F = await ethers.getContractFactory("DevLock");
    const d = await F.deploy(tokenAddr, beneficiary, until);
    await d.waitForDeployment();
    lockAddr = await d.getAddress();
    lock = new ethers.Contract(lockAddr, LOCK_ABI, dev);
    console.log("DevLock deployed:", lockAddr, "-> put DEVLOCK=" + lockAddr + " in .env and `devlock` in site/config.js");
  }

  const amount = env("LOCK_AMOUNT") ? ethers.parseUnits(env("LOCK_AMOUNT"), decimals) : bal;
  if (amount === 0n) throw new Error("nothing to lock (balance 0)");
  if (amount > bal) throw new Error(`LOCK_AMOUNT above the dev wallet balance (${ethers.formatUnits(bal, decimals)})`);
  console.log(`locking ${ethers.formatUnits(amount, decimals)} ${symbol} (${pct(amount)} of supply)`);
  if (dry) { console.log("DRY_RUN: nothing sent"); return; }
  if ((await token.allowance(dev.address, lockAddr)) < amount) {
    const a = await token.approve(lockAddr, amount);
    await a.wait();
  }
  const tx = await lock.deposit(amount);
  await tx.wait();
  const lockedNow = await lock.locked();
  console.log(`locked. DevLock ${lockAddr} now holds ${ethers.formatUnits(lockedNow, decimals)} ${symbol} = ${pct(lockedNow)} of supply | dev wallet keeps ${ethers.formatUnits(await token.balanceOf(dev.address), decimals)}`);
  console.log("verify:  node scripts/verify-sourcify.js " + lockAddr + " contracts/DevLock.sol:DevLock");
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
