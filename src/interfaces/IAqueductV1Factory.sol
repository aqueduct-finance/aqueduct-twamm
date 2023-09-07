// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import {IAqueductV1Auction} from "./IAqueductV1Auction.sol";

interface IAqueductV1Factory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256);
    event SetFeeTo(address feeTo);
    event SetFeeToSetter(address feeToSetter);

    error FACTORY_IDENTICAL_ADDRESSES();
    error FACTORY_ZERO_ADDRESS();
    error FACTORY_PAIR_EXISTS();
    error FACTORY_FORBIDDEN();

    function feeTo() external view returns (address);

    function feeToSetter() external view returns (address);

    function getPair(address tokenA, address tokenB) external view returns (address pair);

    function allPairs(uint256) external view returns (address pair);

    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setFeeTo(address) external;

    function setFeeToSetter(address) external;

    function auction() external view returns (IAqueductV1Auction);
}
