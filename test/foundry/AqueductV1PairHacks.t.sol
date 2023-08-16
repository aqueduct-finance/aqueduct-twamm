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

import "forge-std/console2.sol";

contract AqueductV1PairTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }
}

contract AqueductV1PairHarnessTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1PairHarness = new AqueductV1PairHarness(sf.host);
    }

    // uint112 reserve0,
    // uint112 reserve1,
    // uint112 totalFlow0,
    // uint112 totalFlow1
    function testFuzz_calculateReservesBothFlows() public {
        // Arrange
        // vm.assume(reserve0 > 1 * 10 ** 18);
        // vm.assume(reserve1 > 1 * 10 ** 18);
        // vm.assume(totalFlow0 > 1 * 10 ** 18);
        // vm.assume(totalFlow1 > 1 * 10 ** 18);
        uint112 reserve0 = 12146477822395085832;
        uint112 reserve1 = 1904548252486524730983975;
        uint112 totalFlow0 = 1286356393237815871862620419346769;
        uint112 totalFlow1 = 1000000000000000001;
        uint256 kLast = uint256(reserve0) * reserve1;
        uint32 timeElapsed = 12;

        // Act & Assert
        vm.expectRevert();
        (uint112 calculatedReserve0, uint112 calculatedReserve1) = aqueductV1PairHarness
            .exposed_calculateReservesBothFlows(kLast, totalFlow0, totalFlow1, timeElapsed, reserve0, reserve1);
    }

    // uint256 kLast,
    // uint112 totalFlow0,
    // uint32 timeElapsed,
    // uint112 reserve0
    function testFuzz_calculateReservesFlow0() public {
        // Arrange
        // uint32 tenYears = 315600000;
        // vm.assume(kLast > reserve0);
        // vm.assume(timeElapsed > 12 && timeElapsed < tenYears);
        // vm.assume(totalFlow0 > 0);
        uint256 kLast = 5192296858534827628530496329220095;
        uint112 totalFlow0 = 1;
        uint32 timeElapsed = 13;
        uint112 reserve0 = 5192296858534827628530496329220084;

        // uint112 expectedReserveAmountSinceTime0 = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(
        //     totalFlow0,
        //     timeElapsed
        // );

        // uint112 expectedReserve0 = reserve0 + expectedReserveAmountSinceTime0;
        // uint112 expectedReserve1 = uint112(kLast / expectedReserve0);

        // Act
        vm.expectRevert();
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow0(
            kLast,
            totalFlow0,
            timeElapsed,
            reserve0
        );

        // Assert
        // assertEq(resultReserve0, expectedReserve0);
        // assertEq(resultReserve1, expectedReserve1);
    }

    // uint256 kLast,
    // uint112 totalFlow1,
    // uint32 timeElapsed,
    // uint112 reserve1
    function testFuzz_calculateReservesFlow1() public {
        // Arrange
        // uint32 onwYear = 31560000;
        // vm.assume(kLast > reserve1);
        // vm.assume(timeElapsed > 12 && timeElapsed < onwYear);
        // vm.assume(totalFlow1 > 0);
        uint256 kLast = 5192296858534827628530496329220096;
        uint112 totalFlow1 = 1;
        uint32 timeElapsed = 13;
        uint112 reserve1 = 5192296858534827628530496329220084;

        // uint112 expectedReserveAmountSinceTime1 = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(
        //     totalFlow1,
        //     timeElapsed
        // );

        // uint256 expectedReserve1 = uint256(reserve1) + expectedReserveAmountSinceTime1;
        // uint112 expectedReserve0 = uint112(kLast / expectedReserve1);

        // Act
        vm.expectRevert();
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow1(
            kLast,
            totalFlow1,
            timeElapsed,
            reserve1
        );

        // // Assert
        // assertEq(resultReserve0, expectedReserve0);
        // assertEq(resultReserve1, expectedReserve1);
    }
}
