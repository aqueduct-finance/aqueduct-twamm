// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

interface IAqueductV1Auction {
    event PlaceBid(address token, address pair, uint256 bid, uint256 swapAmount, uint256 amountOut, uint256 deadline);
    event ExecuteWinningBid(
        address pair,
        address winningBidderAddress,
        address swapToken,
        uint256 lockedSwapAmountOut,
        address bidToken,
        uint256 winningBid
    );

    error AUCTION_ALREADY_EXECUTED();
    error AUCTION_PAIR_DOESNT_EXIST();
    error AUCTION_EXPIRED();
    error AUCTION_INSUFFICIENT_BID();
    error AUCTION_TRANSFER_FAILED();
    error AUCTION_TOKEN_NOT_IN_PAIR();
    error AUCTION_LOCKED();
    error AUCTION_INVALID_PAIR();

    function factory() external view returns (address);

    function placeBid(address token, address pair, uint256 bid, uint256 swapAmount, uint256 deadline) external;

    function executeWinningBid(address pair) external;
}
