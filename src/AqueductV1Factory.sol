// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

import {IAqueductV1Factory} from "./interfaces/IAqueductV1Factory.sol";
import {IAqueductV1Auction} from "./interfaces/IAqueductV1Auction.sol";
import {AqueductV1Auction} from "./AqueductV1Auction.sol";
import {AqueductV1Pair} from "./AqueductV1Pair.sol";
import {IAqueductV1Pair} from "./interfaces/IAqueductV1Pair.sol";
import {ISuperfluid, ISuperToken, SuperAppDefinitions, ISuperApp} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

contract AqueductV1Factory is IAqueductV1Factory {
    bytes32 public constant PAIR_HASH = keccak256(type(AqueductV1Pair).creationCode);

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // superfluid
    ISuperfluid immutable host;

    // auction
    IAqueductV1Auction public immutable override auction;

    constructor(address _feeToSetter, ISuperfluid _host) {
        if (address(_host) == address(0)) revert HOST_ZERO_ADDRESS();
        feeToSetter = _feeToSetter;
        host = _host;

        // deploy auction contract
        auction = new AqueductV1Auction();
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        if (tokenA == tokenB) revert FACTORY_IDENTICAL_ADDRESSES();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert FACTORY_ZERO_ADDRESS();
        if (getPair[token0][token1] != address(0)) revert FACTORY_PAIR_EXISTS(); // single check is sufficient

        pair = address(new AqueductV1Pair{salt: keccak256(abi.encodePacked(token0, token1))}());
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
}
