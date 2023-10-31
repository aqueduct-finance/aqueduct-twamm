
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

import {IAqueductV1Factory} from "../interfaces/IAqueductV1Factory.sol";
import {IAqueductV1Auction} from "../interfaces/IAqueductV1Auction.sol";
import {AccumulatorOverride} from "./AccumulatorOverride.sol";
import {IAqueductV1Pair} from "../interfaces/IAqueductV1Pair.sol";
import {ISuperfluid, ISuperToken, SuperAppDefinitions, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

/*

    This contract is a copy of AqueductV1Factory, but deploys AccumulatorOverride instead of AqueductV1Pair

    AccumulatorOverride is used to set accumulators to arbitrary values (to test overflow)

*/

contract TestFactory is IAqueductV1Factory {
    bytes32 public constant PAIR_HASH = keccak256(type(AccumulatorOverride).creationCode);

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // superfluid
    ISuperfluid immutable host;

    // auction
    IAqueductV1Auction public override auction;
    address public override auctionSetter;

    constructor(address _feeToSetter, ISuperfluid _host) {
        if (address(_host) == address(0)) revert HOST_ZERO_ADDRESS();
        feeToSetter = _feeToSetter;
        auctionSetter = _feeToSetter; // set auctionSetter the same as fee setter
        host = _host;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        if (tokenA == tokenB) revert FACTORY_IDENTICAL_ADDRESSES();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert FACTORY_ZERO_ADDRESS();
        if (getPair[token0][token1] != address(0)) revert FACTORY_PAIR_EXISTS(); // single check is sufficient

        pair = address(new AccumulatorOverride{salt: keccak256(abi.encodePacked(token0, token1))}());
        IAqueductV1Pair(pair).initialize(ISuperToken(token0), ISuperToken(token1), host);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);

        // register superapp
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL;
        host.registerAppByFactory(ISuperApp(pair), configWord);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        if (msg.sender != feeToSetter) revert FACTORY_FORBIDDEN();
        feeTo = _feeTo;
        emit SetFeeTo(_feeTo);
    }

    function setFeeToSetter(address _feeToSetter) external override {
        if (msg.sender != feeToSetter) revert FACTORY_FORBIDDEN();
        feeToSetter = _feeToSetter;
        emit SetFeeToSetter(_feeToSetter);
    }

    function setAuction(address _auction) external override {
        if (msg.sender != auctionSetter) revert FACTORY_FORBIDDEN();
        auction = IAqueductV1Auction(_auction);
        emit SetAuction(_auction);
    }

    function setAuctionSetter(address _auctionSetter) external override {
        if (msg.sender != auctionSetter) revert FACTORY_FORBIDDEN();
        auctionSetter = _auctionSetter;
        emit SetAuctionSetter(_auctionSetter);
    }
}
