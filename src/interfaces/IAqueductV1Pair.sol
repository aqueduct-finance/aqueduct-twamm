// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

//solhint-disable func-name-mixedcase

import {ISuperToken, ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IAqueductV1ERC20} from "./IAqueductV1ERC20.sol";

interface IAqueductV1Pair is IAqueductV1ERC20 {
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event RetrieveFunds(ISuperToken superToken, address recipient, uint256 returnedBalance);
    event Sync(uint112 reserve0, uint112 reserve1);

    error PAIR_LOCKED();
    error PAIR_TRANSFER_FAILED();
    error PAIR_FORBIDDEN();
    error PAIR_OVERFLOW();
    error PAIR_INSUFFICIENT_LIQUIDITY_MINTED();
    error PAIR_INSUFFICIENT_LIQUIDITY_BURNED();
    error PAIR_INSUFFICIENT_OUTPUT_AMOUNT();
    error PAIR_INVALID_TO();
    error PAIR_INSUFFICIENT_LIQUIDITY();
    error PAIR_INSUFFICIENT_INPUT_AMOUNT();
    error PAIR_K();
    error PAIR_TOKEN_NOT_IN_POOL();
    error PAIR_SUPPORT_ONLY_ONE_HOST();

    function MINIMUM_LIQUIDITY() external pure returns (uint256);

    function factory() external view returns (address);

    function token0() external view returns (ISuperToken);

    function token1() external view returns (ISuperToken);

    function getRealTimeIncomingFlowRates() external view returns (uint96 totalFlow0, uint96 totalFlow1, uint32 time);

    function getStaticReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function getReservesAtTime(uint32 time) external view returns (uint112 reserve0, uint112 reserve1);

    function twap0CumulativeLast() external view returns (uint256);

    function twap1CumulativeLast() external view returns (uint256);

    function kLast() external view returns (uint256);

    function getRealTimeUserBalances(
        address user
    ) external view returns (uint256 balance0, uint256 balance1, uint256 time);

    function getUserBalancesAtTime(
        address user,
        uint32 time
    ) external view returns (uint256 balance0, uint256 balance1);

    function mint(address to) external returns (uint256 liquidity);

    function burn(address to) external returns (uint256 amount0, uint256 amount1);

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;

    function retrieveFunds(ISuperToken superToken) external returns (uint256 returnedBalance);

    function sync() external;

    function initialize(ISuperToken, ISuperToken, ISuperfluid) external;
}
