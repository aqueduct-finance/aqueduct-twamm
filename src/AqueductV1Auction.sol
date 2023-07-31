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
        uint256 lockedSwapAmountOut;
        uint256 lastAuctionTimestamp;
    }
    mapping(address => Auction) public getAuction; // poolAddress => Auction

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert AUCTION_EXPIRED();
        _;
    }

    function swap(
        address token,
        address pair,
        uint256 swapAmount,
        uint112 reserve0, 
        uint112 reserve1,
        address token0
    ) internal returns (uint256 amountOut) {
        if (token == token0) {
            uint256 numerator = swapAmount * reserve1;
            uint256 denominator = reserve0 + swapAmount;
            amountOut = numerator / denominator;

            _safeTransfer(token, pair, swapAmount);
            IAqueductV1Pair(pair).swap(0, amountOut, address(this));
        } else {
            uint256 numerator = swapAmount * reserve0;
            uint256 denominator = reserve1 + swapAmount;
            amountOut = numerator / denominator;

            _safeTransfer(token, pair, swapAmount);
            IAqueductV1Pair(pair).swap(amountOut, 0, address(this));
        }
    }

    function placeBid(
        address token,
        address pair,
        uint256 bid,
        uint256 swapAmount,
        uint256 deadline
    ) external ensure(deadline) {
        Auction memory auction = getAuction[pair];

        if (block.timestamp > auction.lastAuctionTimestamp) {
            // if there is a winningBid, execute previous auction, otherwise just reset timestamp
            if (auction.winningBid > 0) {
                executeWinningBid(pair);
                auction = getAuction[pair];
            } else {
                auction.lastAuctionTimestamp = block.timestamp;
            }
        }

        address token0 = address(IAqueductV1Pair(pair).token0());
        address token1 = address(IAqueductV1Pair(pair).token1());

        // return old winner's funds
        (uint112 reserve0, uint112 reserve1, ) = IAqueductV1Pair(pair).getReserves();
        if (auction.winningBid + auction.winningSwapAmount > 0) {
            // swap locked funds back
            address oppositeToken = auction.token == token0 ? token1 : token0;
            uint256 returnAmountOut = swap(oppositeToken, pair, auction.lockedSwapAmountOut, reserve0, reserve1, token0);

            // transfer
            _safeTransfer(auction.token, auction.winningBidderAddress, auction.winningBid + returnAmountOut);
        }

        //  if token1, need to convert to token0 denominated value
        uint256 bidValue = bid;
        (reserve0, reserve1, ) = IAqueductV1Pair(pair).getReserves();
        if (token == token1) {
            bidValue = (bid * reserve0) / reserve1;
        }

        // revert if bid's value is lte to winning bid or bid is under 0.3% of total amount
        if (bidValue <= auction.winningBid || bid < (bid + swapAmount) * 3 / 1000) revert AUCTION_INSUFFICIENT_BID();
        TransferHelper.safeTransferFrom(token, msg.sender, address(this), bid + swapAmount);

        // just swap the swap amount, bid/fee will be sent in executeWinningBid()
        // swapped funds will be locked until executeWinningBid() is called
        uint256 amountOut = swap(token, pair, swapAmount, reserve0, reserve1, token0);

        // update auction
        auction.token = token;
        auction.winningBid = bid;
        auction.winningSwapAmount = swapAmount;
        auction.lockedSwapAmountOut = amountOut;
        auction.winningBidderAddress = msg.sender;
        getAuction[pair] = auction;
    }

    function executeWinningBid(address pair) public {
        Auction memory auction = getAuction[pair];
        if (block.timestamp <= auction.lastAuctionTimestamp || auction.winningBid == 0)
            revert AUCTION_ALREADY_EXECUTED();

        // transfer bid to pool
        _safeTransfer(auction.token, pair, auction.winningBid);

        // transfer locked swap to winner
        address token0 = address(IAqueductV1Pair(pair).token0());
        address token1 = address(IAqueductV1Pair(pair).token1());
        address oppositeToken = auction.token == token0 ? token1 : token0;
        _safeTransfer(oppositeToken, auction.winningBidderAddress, auction.lockedSwapAmountOut);

        // sync reserves
        IAqueductV1Pair(pair).sync();

        // reset auction
        // don't reset timestamp here, will reset on first bid in next auction
        auction.winningBid = 0;
        auction.winningSwapAmount = 0;
        getAuction[pair] = auction;
    }

    /**
     * @notice To be called from the pair contract in a superapp callback, prevents reverts
     * reasoning: superfluid protocol will 'jail' a superapp if it reverts when a stream is updated/deleted, performs safety checks
     * @param pair The address of the pair that the auction is for
     */
    function safeExecuteWinningBid(address pair) external {
        Auction memory auction = getAuction[pair];

        if (block.timestamp > auction.lastAuctionTimestamp && auction.winningBid > 0) {
            executeWinningBid(pair);
        }
    }

    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        if (!success && (data.length != 0 || !abi.decode(data, (bool)))) revert AUCTION_TRANSFER_FAILED();
    }
}