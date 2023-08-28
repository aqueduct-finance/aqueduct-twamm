// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

//solhint-disable no-global-import
//solhint-disable no-console

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {IAqueductV1Pair} from "../../src/interfaces/IAqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";
import {AqueductV1PairHarness} from "./utils/AqueductV1PairHarness.sol";

import {AqueductTester} from "./utils/AqueductTester.sol";
import {Math} from "../../src/libraries/Math.sol";
import {UQ112x112} from "../../src/libraries/UQ112x112.sol";

import "forge-std/console2.sol";

contract AqueductV1PairHacks is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }
}

contract AqueductV1PairHarnessTest is AqueductTester {
    using UQ112x112 for uint224;

    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1PairHarness = new AqueductV1PairHarness(sf.host);
    }

    function testFuzz_calculateReservesBothFlows(
        uint112 reserve0,
        uint112 reserve1,
        uint112 totalFlow0,
        uint112 totalFlow1,
        uint32 timeElapsed
    ) public {
        // Arrange
        vm.assume(reserve0 != 0);
        vm.assume(reserve1 != 0);
        vm.assume(totalFlow0 != 0);
        vm.assume(totalFlow1 != 0);

        if (
            uint256(reserve0) + (uint256(totalFlow0) * uint256(timeElapsed) * (10000 - 30) / 10000) > type(uint112).max || 
            uint256(reserve1) + (uint256(totalFlow1) * uint256(timeElapsed) * (10000 - 30) / 10000) > type(uint112).max
        ) {
            vm.expectRevert();
        }

        uint256 kLast = uint256(reserve0) * reserve1;

        // Act & Assert
        aqueductV1PairHarness.exposed_calculateReservesBothFlows(kLast, totalFlow0, totalFlow1, timeElapsed, reserve0, reserve1);
    }

    function testFuzz_calculateReservesFlow0(
        uint112 totalFlow0,
        uint32 timeElapsed,
        uint112 reserve0,
        uint112 reserve1
    ) public {
        // Arrange
        vm.assume(totalFlow0 != 0);
        vm.assume(reserve0 != 0);
        vm.assume(reserve1 != 0);

        uint256 kLast = uint256(reserve0) * reserve1;

        if (
            uint256(reserve0) + (uint256(totalFlow0) * uint256(timeElapsed) * (10000 - 30) / 10000) > type(uint112).max
        ) {
            vm.expectRevert();
        }

        // Act
        aqueductV1PairHarness.exposed_calculateReservesFlow0(
            kLast,
            totalFlow0,
            timeElapsed,
            reserve0
        );
    }

    function testFuzz_calculateReservesFlow1(
        uint112 totalFlow1,
        uint32 timeElapsed,
        uint112 reserve0,
        uint112 reserve1
    ) public {
        // Arrange
        vm.assume(totalFlow1 != 0);
        vm.assume(reserve0 != 0);
        vm.assume(reserve1 != 0);

        uint256 kLast = uint256(reserve0) * reserve1;

        if (
            uint256(reserve1) + (uint256(totalFlow1) * uint256(timeElapsed) * (10000 - 30) / 10000) > type(uint112).max
        ) {
            vm.expectRevert();
        }

        // Act
        aqueductV1PairHarness.exposed_calculateReservesFlow1(
            kLast,
            totalFlow1,
            timeElapsed,
            reserve1
        );
    }

    function testFuzz_getTwapCumulative(
        uint112 newReserve,
        uint112 storedReserve,
        uint112 totalFlow,
        uint112 totalFlowDenominator,
        uint32 timeElapsed
    ) public {
        vm.assume(newReserve != 0);
        vm.assume(storedReserve != 0);
        vm.assume(totalFlowDenominator != 0);

        if (
            (newReserve > storedReserve && newReserve - storedReserve > uint256(totalFlow) * uint256(timeElapsed)) ||
            uint256(storedReserve) + (uint256(totalFlow) * uint256(timeElapsed)) > type(uint112).max
        ) {
            vm.expectRevert();
        }

        // Act
        aqueductV1PairHarness.exposed_getTwapCumulative(
            newReserve,
            storedReserve,
            totalFlow,
            totalFlowDenominator,
            timeElapsed
        );
    }
}
