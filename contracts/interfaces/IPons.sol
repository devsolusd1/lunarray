// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Pons v2 per-launch bonding curve (Robinhood Chain). Found via IPonsFactory.getLaunchedToken(token).curve.
///         Native (ETH-paired) launches: buy() is payable and msg.value must equal quoteIn. A buy larger than what is
///         left on the curve is filled partially and the rest is refunded to the caller in the same transaction.
interface IPonsCurve {
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    /// @return quoteReserve pricing quote reserve (includes the phantom reserve)
    /// @return tokenReserve pricing token reserve
    function getReserves() external view returns (uint256 quoteReserve, uint256 tokenReserve);
    function graduated() external view returns (bool);
    function readyToGraduate() external view returns (bool);
    function sellableTokens() external view returns (uint256);
}

/// @notice Pons v2 factory (Robinhood Chain: 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e)
interface IPonsFactory {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    /// @notice Permissionless recovery when the graduating buy could not create the pool.
    function createGraduatedPool(address token) external;
}
