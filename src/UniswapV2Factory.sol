// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity =0.8.12;

import "./interfaces/IUniswapV2Factory.sol";
import "./UniswapV2Pair.sol";

contract UniswapV2Factory is IUniswapV2Factory {
    bytes32 public constant PAIR_HASH = keccak256(type(UniswapV2Pair).creationCode);

    address public override feeTo;
    address public override feeToSetter;

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    // superfluid
    ISuperfluid host;

    constructor(address _feeToSetter, ISuperfluid _host) {
        assert(address(_host) != address(0));
        feeToSetter = _feeToSetter;
        host = _host;
    }

    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        require(tokenA != tokenB, "UniswapV2: IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "UniswapV2: ZERO_ADDRESS");
        require(getPair[token0][token1] == address(0), "UniswapV2: PAIR_EXISTS"); // single check is sufficient

        pair = address(new UniswapV2Pair{salt: keccak256(abi.encodePacked(token0, token1))}());
        IUniswapV2Pair(pair).initialize(ISuperToken(token0), ISuperToken(token1), host);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // populate mapping in the reverse direction
        allPairs.push(pair);

        // register superapp
        uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL;
        host.registerAppByFactory(ISuperApp(pair), configWord);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
        feeTo = _feeTo;
    }

    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, "UniswapV2: FORBIDDEN");
        feeToSetter = _feeToSetter;
    }
}
