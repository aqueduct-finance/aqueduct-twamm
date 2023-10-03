// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

import {AqueductV1Pair} from "../../../src/AqueductV1Pair.sol";
import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

contract AqueductV1PairHarness is AqueductV1Pair {
    constructor(ISuperfluid host) AqueductV1Pair() {}

    function exposed_calculateFees(uint112 totalFlow, uint32 timeElapsed) external pure returns (uint112) {
        return _calculateFees(totalFlow, timeElapsed);
    }

    function exposed_calculateReserveAmountSinceTime(
        uint112 totalFlow,
        uint32 timeElapsed
    ) external pure returns (uint112) {
        return _calculateReserveAmountSinceTime(totalFlow, timeElapsed);
    }

    function exposed_calculateReservesBothFlows(
        uint256 _kLast,
        uint112 totalFlow0,
        uint112 totalFlow1,
        uint32 timeElapsed,
        uint112 _reserve0,
        uint112 _reserve1
    ) external pure returns (uint112, uint112) {
        return _calculateReservesBothFlows(_kLast, totalFlow0, totalFlow1, timeElapsed, _reserve0, _reserve1);
    }

    function exposed_calculateReservesFlow0(
        uint256 _kLast,
        uint112 totalFlow0,
        uint32 timeElapsed,
        uint112 _reserve0
    ) external pure returns (uint112 reserve0, uint112 reserve1) {
        return _calculateReservesFlow0(_kLast, totalFlow0, timeElapsed, _reserve0);
    }

    function exposed_calculateReservesFlow1(
        uint256 _kLast,
        uint112 totalFlow1,
        uint32 timeElapsed,
        uint112 _reserve1
    ) external pure returns (uint112 reserve0, uint112 reserve1) {
        return _calculateReservesFlow1(_kLast, totalFlow1, timeElapsed, _reserve1);
    }

    function exposed_getTwapCumulative(
        uint112 newReserve,
        uint112 storedReserve,
        uint96 totalFlow,
        uint96 totalFlowDenominator,
        uint32 timeElapsed
    ) external pure returns (uint256) {
        return _getTwapCumulative(newReserve, storedReserve, totalFlow, totalFlowDenominator, timeElapsed);
    }
}
