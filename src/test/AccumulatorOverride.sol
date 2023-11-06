// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

import "../AqueductV1Pair.sol";

/*

    This contract inherits AqueductV1Pair, and adds setters for twap0CumulativeLast and twap1CumulativeLast
    
    These variables are intentionally inaccessible, so we must inherit the contract to test them (primarily need to test for overflow)

    There is no good way to test accumulator overflow because netFlowRate is an int96 - see notes in test/hardhat/AqueductV1Pair.spec.ts

*/

contract AccumulatorOverride is AqueductV1Pair {
    constructor() AqueductV1Pair() {}

    function setTwap0CumulativeLast(uint256 newValue) public {
        twap0CumulativeLast = newValue;
    }

    function setTwap1CumulativeLast(uint256 newValue) public {
        twap1CumulativeLast = newValue;
    }
}
