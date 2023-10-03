// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

//solhint-disable no-global-import
//solhint-disable no-console
//solhint-disable func-name-mixedcase
//solhint-disable var-name-mixedcase

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {IAqueductV1Pair} from "../../src/interfaces/IAqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";
import {AqueductV1PairHarness} from "./utils/AqueductV1PairHarness.sol";

import {Math} from "../../src/libraries/Math.sol";
import {AqueductTester} from "./utils/AqueductTester.sol";

import "forge-std/console2.sol";

contract AqueductV1PairReservesTest is AqueductTester {

    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
        aqueductV1PairHarness = new AqueductV1PairHarness(sf.host);
    }

    function test_getReserves_ReturnsReserves() public {
        // Arrange & Act
        (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) = aqueductV1Pair.getStaticReserves();

        // Assert
        assertEq(_reserve0, 0);
        assertEq(_reserve1, 0);
        assertEq(_blockTimestampLast, 0);
    }

    function test_calculateFees_Basic() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 1;

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, 30); // Expecting 0.3% of 10000, which is 30
    }

    function test_calculateFees_NoFlow() public {
        // Arrange
        uint112 totalFlow = 0;
        uint32 timeElapsed = 100;

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, 0);
    }

    function test_calculateFees_NoTimeElasped() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 0;

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, 0);
    }

    function test_calculateFees_LongTime() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 100;

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, 3000); // Expecting 0.3% of 10000 over 100 units of time, which is 3000
    }

    function test_calculateFees_MaxValues() public {
        // Arrange
        uint112 totalFlow = uint112(sf.cfa.MAXIMUM_FLOW_RATE()); // max 96 bits
        uint32 timeElapsed = type(uint16).max; // max == 112 - 96 = 16 bits

        uint112 expectedFee = uint112((uint256(totalFlow) * timeElapsed * TWAP_FEE) / 10000);

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, expectedFee);

        // test overflow
        timeElapsed = type(uint32).max;
        vm.expectRevert();
        aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);
    }

    function testFuzz_calculateFees(uint112 totalFlow, uint32 timeElapsed) public {
        // Arrange
        vm.assume(totalFlow < sf.cfa.MAXIMUM_FLOW_RATE());

        // expect revert if overflow
        bool expectOverflow = (uint256(totalFlow) * uint256(timeElapsed) * TWAP_FEE) / 10000 > type(uint112).max;
        if (expectOverflow) {
            vm.expectRevert();
        }

        uint112 expectedFee = uint112((uint256(totalFlow) * timeElapsed * TWAP_FEE) / 10000);

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        if (!expectOverflow) {
            assertEq(calculatedFee, expectedFee);
        }
    }

    function test_calculateReserveAmountSinceTime_Basic() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 12;
        uint112 expectedReserve = (totalFlow * timeElapsed * (10000 - TWAP_FEE)) / 10000;

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, expectedReserve);
    }

    function test_calculateReserveAmountSinceTime_NoFlow() public {
        // Arrange
        uint112 totalFlow = 0;
        uint32 timeElapsed = 100;

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, 0);
    }

    function test_calculateReserveAmountSinceTime_NoTimeElapsed() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 0;

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, 0);
    }

    function test_calculateReserveAmountSinceTime_MaxValues() public {
        // Arrange
        uint112 totalFlow = uint112(sf.cfa.MAXIMUM_FLOW_RATE()); // max 96 bits
        uint32 timeElapsed = type(uint16).max; // max == 112 - 96 = 16 bits

        uint112 expectedReserveAmount = uint112((uint256(totalFlow) * timeElapsed * (10000 - TWAP_FEE)) / 10000);

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, expectedReserveAmount);

        // test overflow
        timeElapsed = type(uint32).max;
        vm.expectRevert();
        aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);
    }

    function testFuzz_calculateReserveAmountSinceTime(uint112 totalFlow, uint32 timeElapsed) public {
        // Arrange
        vm.assume(totalFlow < (sf.cfa.MAXIMUM_FLOW_RATE()));

        // expect revert if overflow
        bool expectOverflow = (uint256(totalFlow) * uint256(timeElapsed) * (10000 - TWAP_FEE)) / 10000 >
            type(uint112).max;
        if (expectOverflow) {
            vm.expectRevert();
        }

        uint112 expectedReserveAmount = uint112((uint256(totalFlow) * timeElapsed * (10000 - TWAP_FEE)) / 10000);

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        if (!expectOverflow) {
            assertEq(reserveAmount, expectedReserveAmount);
        }
    }

    function test_calculateReservesBothFlows_Basic() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 1 * 10 ** 18;
        uint112 totalFlow1 = 1 * 10 ** 18;
        uint32 timeElapsed = 12;
        uint112 reserve0 = 1 * 10 ** 18;
        uint112 reserve1 = 1 * 10 ** 18;

        uint112 expectedReserveSinceTime0 = (totalFlow0 * timeElapsed * (10000 - TWAP_FEE)) / 10000;
        uint112 expectedReserveSinceTime1 = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(
            totalFlow0,
            timeElapsed
        );

        uint112 expectedReserve0 = uint112(
            Math.sqrt((kLast * (reserve0 + expectedReserveSinceTime0)) / (reserve1 + expectedReserveSinceTime1))
        );
        uint112 expectedReserve1 = uint112(kLast / reserve0);

        // Act
        (uint112 calculatedReserve0, uint112 calculatedReserve1) = aqueductV1PairHarness
            .exposed_calculateReservesBothFlows(kLast, totalFlow0, totalFlow1, timeElapsed, reserve0, reserve1);

        // Assert
        assertEq(calculatedReserve0, expectedReserve0);
        assertEq(calculatedReserve1, expectedReserve1);
    }

    function test_calculateReservesBothFlows_ZeroFlows() public {
        // Arrange
        uint256 _kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 0;
        uint112 totalFlow1 = 0;
        uint32 timeElapsed = 12;
        uint112 _reserve0 = 1 * 10 ** 18;
        uint112 _reserve1 = 1 * 10 ** 18;

        // Act
        (uint112 reserve0, uint112 reserve1) = aqueductV1PairHarness.exposed_calculateReservesBothFlows(
            _kLast,
            totalFlow0,
            totalFlow1,
            timeElapsed,
            _reserve0,
            _reserve1
        );

        // Assert
        assertEq(reserve0, _reserve0); // Assuming when no flow, reserve remains same.
        assertEq(reserve1, _reserve1);
    }

    function test_calculateReservesBothFlows_NoTimeElapsed() public {
        // Arrange
        uint256 _kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 1 * 10 ** 18;
        uint112 totalFlow1 = 1 * 10 ** 18;
        uint32 timeElapsed = 0;
        uint112 _reserve0 = 1 * 10 ** 18;
        uint112 _reserve1 = 1 * 10 ** 18;

        // Act
        (uint112 reserve0, uint112 reserve1) = aqueductV1PairHarness.exposed_calculateReservesBothFlows(
            _kLast,
            totalFlow0,
            totalFlow1,
            timeElapsed,
            _reserve0,
            _reserve1
        );

        // Assert
        assertEq(reserve0, _reserve0); // Assuming when no time has elapsed, reserve remains same.
        assertEq(reserve1, _reserve1);
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
            uint256(reserve0) + ((uint256(totalFlow0) * uint256(timeElapsed) * (10000 - 30)) / 10000) >
            type(uint112).max ||
            uint256(reserve1) + ((uint256(totalFlow1) * uint256(timeElapsed) * (10000 - 30)) / 10000) >
            type(uint112).max
        ) {
            vm.expectRevert();
        }

        uint256 kLast = uint256(reserve0) * reserve1;

        // Act & Assert
        aqueductV1PairHarness.exposed_calculateReservesBothFlows(
            kLast,
            totalFlow0,
            totalFlow1,
            timeElapsed,
            reserve0,
            reserve1
        );
    }

    function test_calculateReservesFlow0_Basic() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 1 * 10 ** 18;
        uint32 timeElapsed = 12;
        uint112 reserve0 = 1 * 10 ** 18;

        // This is the expected result of _calculateReserveAmountSinceTime with the given values
        uint112 expectedReserveAmountSinceTime0 = 11964000000000000000; // ((1 * 10 ** 18) * 12 * (10000 - 30)) / 10000

        uint112 expectedReserve0 = reserve0 + expectedReserveAmountSinceTime0;
        uint112 expectedReserve1 = uint112(kLast / expectedReserve0);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow0(
            kLast,
            totalFlow0,
            timeElapsed,
            reserve0
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
    }

    function test_calculateReservesFlow0_NoFlow() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 0;
        uint32 timeElapsed = 12;
        uint112 reserve0 = 1 * 10 ** 18;

        // The expected result of _calculateReserveAmountSinceTime with the given values is 0
        uint112 expectedReserve0 = reserve0; // No change
        uint112 expectedReserve1 = uint112(kLast / expectedReserve0);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow0(
            kLast,
            totalFlow0,
            timeElapsed,
            reserve0
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
    }

    function test_calculateReservesFlow0_NoElapsedTime() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 1 * 10 ** 18;
        uint32 timeElapsed = 0;
        uint112 reserve0 = 1 * 10 ** 18;

        // The expected result of _calculateReserveAmountSinceTime with the given values is 0
        uint112 expectedReserve0 = reserve0; // No change
        uint112 expectedReserve1 = uint112(kLast / expectedReserve0);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow0(
            kLast,
            totalFlow0,
            timeElapsed,
            reserve0
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
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
            uint256(reserve0) + ((uint256(totalFlow0) * uint256(timeElapsed) * (10000 - 30)) / 10000) >
            type(uint112).max
        ) {
            vm.expectRevert();
        }

        // Act
        aqueductV1PairHarness.exposed_calculateReservesFlow0(kLast, totalFlow0, timeElapsed, reserve0);
    }

    function test_calculateReservesFlow1_Basic() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow1 = 1 * 10 ** 18;
        uint32 timeElapsed = 12;
        uint112 reserve1 = 1 * 10 ** 18;

        // This is the expected result of _calculateReserveAmountSinceTime with the given values
        uint112 expectedReserveAmountSinceTime1 = 11964000000000000000; // ((1 * 10 ** 18) * 12 * (10000 - 30)) / 10000

        uint112 expectedReserve1 = reserve1 + expectedReserveAmountSinceTime1;
        uint112 expectedReserve0 = uint112(kLast / expectedReserve1);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow1(
            kLast,
            totalFlow1,
            timeElapsed,
            reserve1
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
    }

    function test_calculateReservesFlow1_NoFlow() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow1 = 0;
        uint32 timeElapsed = 12;
        uint112 reserve1 = 1 * 10 ** 18;

        // The expected result of _calculateReserveAmountSinceTime with the given values is 0
        uint112 expectedReserve1 = reserve1; // No change
        uint112 expectedReserve0 = uint112(kLast / expectedReserve1);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow1(
            kLast,
            totalFlow1,
            timeElapsed,
            reserve1
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
    }

    function test_calculateReservesFlow1_NoElapsedTime() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow1 = 1 * 10 ** 18;
        uint32 timeElapsed = 0;
        uint112 reserve1 = 1 * 10 ** 18;

        // The expected result of _calculateReserveAmountSinceTime with the given values is 0
        uint112 expectedReserve1 = reserve1; // No change
        uint112 expectedReserve0 = uint112(kLast / expectedReserve1);

        // Act
        (uint112 resultReserve0, uint112 resultReserve1) = aqueductV1PairHarness.exposed_calculateReservesFlow1(
            kLast,
            totalFlow1,
            timeElapsed,
            reserve1
        );

        // Assert
        assertEq(resultReserve0, expectedReserve0);
        assertEq(resultReserve1, expectedReserve1);
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
            uint256(reserve1) + ((uint256(totalFlow1) * uint256(timeElapsed) * (10000 - 30)) / 10000) >
            type(uint112).max
        ) {
            vm.expectRevert();
        }

        // Act
        aqueductV1PairHarness.exposed_calculateReservesFlow1(kLast, totalFlow1, timeElapsed, reserve1);
    }
}
