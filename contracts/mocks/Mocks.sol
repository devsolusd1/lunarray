// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PoolKey, SwapParams, IUnlockCallback} from "../interfaces/IUniswapV4.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockStateView {
    uint160 public sqrtPriceX96;

    function set(uint160 v) external {
        sqrtPriceX96 = v;
    }

    function getSlot0(bytes32) external view returns (uint160, int24, uint24, uint24) {
        return (sqrtPriceX96, 0, 0, 0);
    }
}

/// Very small PoolManager stand-in: swaps ETH for token at `tokensPerEth` (1e18 = 1:1), holds token inventory.
contract MockPoolManager {
    MockERC20 public token;
    uint256 public tokensPerEth; // scaled 1e18
    uint256 internal owedEth;
    uint256 internal owedToken;

    constructor(MockERC20 t, uint256 rate) {
        token = t;
        tokensPerEth = rate;
    }

    function setRate(uint256 r) external {
        tokensPerEth = r;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory p, bytes calldata) external returns (int256 delta) {
        require(p.zeroForOne && p.amountSpecified < 0, "mock: exact-in eth only");
        uint256 ethIn = uint256(-p.amountSpecified);
        uint256 out = (ethIn * tokensPerEth) / 1e18;
        owedEth = ethIn;
        owedToken = out;
        int256 a0 = -int256(ethIn);
        int256 a1 = int256(out);
        delta = (a0 << 128) | (a1 & int256(uint256(type(uint128).max)));
    }

    function settle() external payable returns (uint256) {
        require(msg.value == owedEth, "mock: bad settle");
        owedEth = 0;
        return msg.value;
    }

    function take(address, address to, uint256 amount) external {
        require(amount == owedToken, "mock: bad take");
        owedToken = 0;
        token.transfer(to, amount);
    }
}

contract MockEscrow {
    mapping(address => uint256) public balanceOf;

    function credit(address r) external payable {
        balanceOf[r] += msg.value;
    }

    function claim() external returns (uint256 amt) {
        amt = balanceOf[msg.sender];
        balanceOf[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok);
    }
}

/// Pons v2 curve stand-in: sells `tokensPerEth` tokens per ETH until `capacityEth` is exhausted, refunding the rest
/// (like the real curve), exposes pricing reserves and a graduated flag. `failing` makes buy() revert.
contract MockCurve {
    MockERC20 public token;
    uint256 public tokensPerEth; // 1e18 = 1:1
    uint256 public quoteReserve;
    uint256 public tokenReserve;
    uint256 public capacityEth;
    bool public graduated;
    bool public failing;

    constructor(MockERC20 t, uint256 rate, uint256 quoteReserve_, uint256 tokenReserve_, uint256 capacityEth_) {
        token = t;
        tokensPerEth = rate;
        quoteReserve = quoteReserve_;
        tokenReserve = tokenReserve_;
        capacityEth = capacityEth_;
    }

    function setReserves(uint256 q, uint256 t) external {
        quoteReserve = q;
        tokenReserve = t;
    }

    function setRate(uint256 r) external {
        tokensPerEth = r;
    }

    function setCapacity(uint256 c) external {
        capacityEth = c;
    }

    function setGraduated(bool g) external {
        graduated = g;
    }

    function setFailing(bool f) external {
        failing = f;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (quoteReserve, tokenReserve);
    }

    function readyToGraduate() external view returns (bool) {
        return capacityEth == 0 && !graduated;
    }

    function sellableTokens() external view returns (uint256) {
        return (capacityEth * tokensPerEth) / 1e18;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 out) {
        require(msg.value == quoteIn, "mock: value != quoteIn");
        require(!graduated, "mock: graduated");
        require(!failing, "mock: curve failing");
        uint256 accept = quoteIn > capacityEth ? capacityEth : quoteIn;
        capacityEth -= accept;
        out = (accept * tokensPerEth) / 1e18;
        require(out >= minTokensOut, "mock: slippage");
        token.transfer(recipient, out);
        if (quoteIn > accept) {
            (bool ok, ) = msg.sender.call{value: quoteIn - accept}("");
            require(ok, "mock: refund");
        }
    }
}
