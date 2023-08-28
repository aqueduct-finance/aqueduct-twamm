// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

//solhint-disable no-global-import
//solhint-disable no-console
//solhint-disable func-name-mixedcase
//solhint-disable var-name-mixedcase

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";
import {AqueductV1PairHarness} from "./utils/AqueductV1PairHarness.sol";

import {UQ112x112} from "../../src/libraries/UQ112x112.sol";
import {Math} from "../../src/libraries/Math.sol";
import {AqueductTester} from "./utils/AqueductTester.sol";

import "forge-std/console2.sol";

contract AqueductV1PairAccumultorTest is AqueductTester {
    using UQ112x112 for uint224;

    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1PairHarness = new AqueductV1PairHarness(sf.host);
    }

    function test_getTwapCumulative_Basic() public {
        // Arrange
        uint112 newReserve = 1 * 10 ** 18;
        uint112 storedReserve = 2 * 10 ** 18;
        uint112 totalFlow = 3 * 10 ** 18;
        uint112 totalFlowDenominator = 4 * 10 ** 18;
        uint32 timeElapsed = 1;

        uint256 expectedTwapCumulative = 5192296858534827628530496329220096;

        // Act
        uint256 twapCumulative = aqueductV1PairHarness.exposed_getTwapCumulative(
            newReserve,
            storedReserve,
            totalFlow,
            totalFlowDenominator,
            timeElapsed
        );

        // Assert
        assertEq(twapCumulative, expectedTwapCumulative);
    }

    function test_getTwapCumulative_ZeroValues() public {
        // Arrange
        uint112 newReserve = 0;
        uint112 storedReserve = 2 * 10 ** 18;
        uint112 totalFlow = 0;
        uint112 totalFlowDenominator = 4 * 10 ** 18;
        uint32 timeElapsed = 0;

        uint256 expectedTwapCumulative = 2596148429267413814265248164610048;

        // Act
        uint256 twapCumulative = aqueductV1PairHarness.exposed_getTwapCumulative(
            newReserve,
            storedReserve,
            totalFlow,
            totalFlowDenominator,
            timeElapsed
        );

        // Assert
        assertEq(twapCumulative, expectedTwapCumulative);
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
