// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import {IAqueductV1Auction} from "./interfaces/IAqueductV1Auction.sol";
import {AqueductV1Pair} from "./AqueductV1Pair.sol";
import {IAqueductV1Pair} from "./interfaces/IAqueductV1Pair.sol";
import {ISuperfluid, ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";
import {IERC20} from "./interfaces/IERC20.sol";

contract AqueductV1Auction is IAqueductV1Auction {
    struct Auction {
        address token;
        address winningBidderAddress;
        uint256 winningBid;
        uint256 winningSwapAmount;
        uint256 lastAuctionTimestamp;
    }
    mapping(address => Auction) public getAuction; // poolAddress => Auction

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert AUCTION_EXPIRED();
        _;
    }

    function placeBid(
        address token,
        address pair,
        uint256 bid,
        uint256 swapAmount,
        uint256 deadline
    ) external ensure(deadline) {
        Auction memory auction = getAuction[pair];

        // if first bid and previous auction hasn't been executed, execute previous auction
        if (block.timestamp > auction.lastAuctionTimestamp && auction.winningBid > 0) {
            executeWinningBid(pair);
            auction = getAuction[pair];
        }

        //  if token1, need to convert to token0 denominated value
        uint256 bidValue = bid;
        if (token == address(IAqueductV1Pair(pair).token1())) {
            (uint112 reserve0, uint112 reserve1, ) = IAqueductV1Pair(pair).getReserves();
            // TODO: multiply all bids by some constant X to increase precision?
            bidValue = (bid * reserve0) / reserve1;
        }

        if (bidValue <= auction.winningBid) revert AUCTION_INSUFFICIENT_BID();

        // TODO: is TransferHelper ok to use here?
        TransferHelper.safeTransferFrom(token, msg.sender, address(this), bid + swapAmount);
        // TODO: track balance for safety?

        // return old winner's funds
        if (auction.winningBid > 0) {
            _safeTransfer(auction.token, auction.winningBidderAddress, auction.winningBid + auction.winningSwapAmount);
        }

        // update auction
        auction.token = token;
        auction.winningBid = bid;
        auction.winningSwapAmount = swapAmount;
        auction.winningBidderAddress = msg.sender;
        getAuction[pair] = auction;
    }

    function executeWinningBid(address pair) public {
        // do we need to restrict this to only be called by the pair?
        // if this function is called from a SF callback in the pair, do we want the possibility of a revert, or better to have it do nothing?

        Auction memory auction = getAuction[pair];
        if (block.timestamp <= auction.lastAuctionTimestamp || auction.winningBid == 0)
            revert AUCTION_ALREADY_EXECUTED();

        // perform swap
        // these swap calls are basically supplying an excess fee, which already automatically goes to LPs
        // if the bid is <0.3% of the swap amount, swap() will revert already
        (uint112 reserve0, uint112 reserve1, ) = IAqueductV1Pair(pair).getReserves();
        if (auction.token == address(IAqueductV1Pair(pair).token0())) {
            uint256 numerator = auction.winningSwapAmount * reserve1;
            uint256 denominator = reserve0 + auction.winningSwapAmount;
            uint256 amountOut = numerator / denominator;

            _safeTransfer(auction.token, pair, auction.winningBid + auction.winningSwapAmount);
            IAqueductV1Pair(pair).swap(0, amountOut, auction.winningBidderAddress);
        } else {
            uint256 numerator = auction.winningSwapAmount * reserve0;
            uint256 denominator = reserve1 + auction.winningSwapAmount;
            uint256 amountOut = numerator / denominator;

            _safeTransfer(auction.token, pair, auction.winningBid + auction.winningSwapAmount);
            IAqueductV1Pair(pair).swap(amountOut, 0, auction.winningBidderAddress);
        }

        // TODO: track balance for safety?

        // reset auction (should be ok to just reset the bid amount and timestamp?)
        auction.lastAuctionTimestamp = block.timestamp;
        auction.winningBid = 0;
        getAuction[pair] = auction;
    }

    // TODO: borrowed from pair contract, is this ok?
    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        if (!success && (data.length != 0 || !abi.decode(data, (bool)))) revert AUCTION_TRANSFER_FAILED();
    }
}