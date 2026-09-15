const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DAY = 86400;

describe("DevLock", () => {
  async function setup() {
    const [dev, treasury, stranger] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    await token.mint(dev.address, ethers.parseEther("16500000"));
    const now = await time.latest();
    const lock = await (await ethers.getContractFactory("DevLock")).deploy(await token.getAddress(), treasury.address, now + 180 * DAY);
    await token.connect(dev).approve(await lock.getAddress(), ethers.MaxUint256);
    return { dev, treasury, stranger, token, lock, unlockAt: now + 180 * DAY };
  }

  it("holds deposits until the date, then pays only the beneficiary", async () => {
    const c = await setup();
    await c.lock.connect(c.dev).deposit(ethers.parseEther("16500000"));
    expect(await c.lock.locked()).to.equal(ethers.parseEther("16500000"));
    expect(await c.lock.totalDeposited()).to.equal(ethers.parseEther("16500000"));
    expect(await c.lock.remaining()).to.be.gt(179 * DAY);
    await expect(c.lock.connect(c.treasury).withdraw(1n)).to.be.revertedWithCustomError(c.lock, "StillLocked");
    await expect(c.lock.connect(c.dev).withdraw(1n)).to.be.revertedWithCustomError(c.lock, "NotBeneficiary");
    await time.increaseTo(c.unlockAt + 1);
    expect(await c.lock.remaining()).to.equal(0);
    await expect(c.lock.connect(c.stranger).withdraw(1n)).to.be.revertedWithCustomError(c.lock, "NotBeneficiary");
    await c.lock.connect(c.treasury).withdraw(ethers.parseEther("500000"));
    expect(await c.token.balanceOf(c.treasury.address)).to.equal(ethers.parseEther("500000"));
    expect(await c.lock.locked()).to.equal(ethers.parseEther("16000000"));
  });

  it("can be extended by the beneficiary only, and never shortened", async () => {
    const c = await setup();
    await expect(c.lock.connect(c.dev).extend(c.unlockAt + DAY)).to.be.revertedWithCustomError(c.lock, "NotBeneficiary");
    await expect(c.lock.connect(c.treasury).extend(c.unlockAt - DAY)).to.be.revertedWithCustomError(c.lock, "CannotShorten");
    await c.lock.connect(c.treasury).extend(c.unlockAt + 365 * DAY);
    expect(await c.lock.unlockAt()).to.equal(c.unlockAt + 365 * DAY);
    await time.increaseTo(c.unlockAt + 1);
    await c.lock.connect(c.dev).deposit(1n);
    await expect(c.lock.connect(c.treasury).withdraw(1n)).to.be.revertedWithCustomError(c.lock, "StillLocked");
  });

  it("rejects a past unlock date and zero amounts", async () => {
    const [dev, treasury] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockERC20")).deploy();
    const F = await ethers.getContractFactory("DevLock");
    await expect(F.deploy(await token.getAddress(), treasury.address, (await time.latest()) - 1)).to.be.revertedWithCustomError(F, "UnlockInThePast");
    const lock = await F.deploy(await token.getAddress(), treasury.address, (await time.latest()) + DAY);
    await expect(lock.connect(dev).deposit(0)).to.be.revertedWithCustomError(lock, "ZeroAmount");
  });
});
