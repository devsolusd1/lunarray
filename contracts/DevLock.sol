// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DevLock
/// @notice Time lock for the dev allocation. Anyone can deposit the token; nothing can leave before `unlockAt`,
///         and then only to the fixed `beneficiary`. The date can be extended by the beneficiary, never shortened.
///         No owner, no other functions, no upgrade. `locked()` is what the site shows as the locked share of supply.
contract DevLock {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint64 public unlockAt;
    uint256 public totalDeposited;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Extended(uint64 unlockAt);

    error ZeroAddress();
    error ZeroAmount();
    error NotBeneficiary();
    error StillLocked();
    error CannotShorten();
    error UnlockInThePast();

    constructor(address token_, address beneficiary_, uint64 unlockAt_) {
        if (token_ == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (unlockAt_ <= block.timestamp) revert UnlockInThePast();
        token = IERC20(token_);
        beneficiary = beneficiary_;
        unlockAt = unlockAt_;
    }

    /// @return tokens currently held by the lock
    function locked() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @return seconds until the lock opens (0 once open)
    function remaining() external view returns (uint256) {
        return block.timestamp >= unlockAt ? 0 : unlockAt - block.timestamp;
    }

    /// @notice Lock more tokens. Permissionless: whoever sends them, they belong to the beneficiary after `unlockAt`.
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }

    /// @notice Push the unlock date further into the future. Only the beneficiary, only later than now.
    function extend(uint64 newUnlockAt) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (newUnlockAt <= unlockAt) revert CannotShorten();
        unlockAt = newUnlockAt;
        emit Extended(newUnlockAt);
    }

    /// @notice After `unlockAt`, the beneficiary takes tokens out (partial or full).
    function withdraw(uint256 amount) external {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        if (block.timestamp < unlockAt) revert StillLocked();
        if (amount == 0) revert ZeroAmount();
        token.safeTransfer(beneficiary, amount);
        emit Withdrawn(beneficiary, amount);
    }
}
