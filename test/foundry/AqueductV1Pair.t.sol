// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

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

import {AqueductTester} from "./utils/AqueductTester.sol";
import {Math} from "../../src/libraries/Math.sol";

import "forge-std/console2.sol";

contract AqueductV1PairTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_getReserves_ReturnsReserves() public {
        // Arrange & Act
        (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) = aqueductV1Pair.getStaticReserves();

        // Assert
        assertEq(_reserve0, 0);
        assertEq(_reserve1, 0);
        assertEq(_blockTimestampLast, 0);
    }

    function test_initialize_RevertsIfFactoryIsNotSender() public {
        // Arrange & Act & Assert
        vm.expectRevert(IAqueductV1Pair.PAIR_FORBIDDEN.selector);
        aqueductV1Pair.initialize(superTokenA, superTokenB, sf.host);
    }
}

contract AqueductV1PairHarnessTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1PairHarness = new AqueductV1PairHarness(sf.host);
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
        uint112 totalFlow = uint112(sf.cfa.MAXIMUM_FLOW_RATE());
        uint32 timeElapsed = type(uint32).max;
        uint112 TWAP_FEE = 30; // 0.3%

        uint112 expectedFee = uint112((uint256(totalFlow) * timeElapsed * TWAP_FEE) / 10000);

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, expectedFee);
    }

    function testFuzz_calculateFees(uint112 totalFlow, uint32 timeElapsed) public {
        // Arrange
        vm.assume(totalFlow < sf.cfa.MAXIMUM_FLOW_RATE());
        uint112 TWAP_FEE = 30; // 0.3%

        uint112 expectedFee = uint112((uint256(totalFlow) * timeElapsed * TWAP_FEE) / 10000);

        // Act
        uint112 calculatedFee = aqueductV1PairHarness.exposed_calculateFees(totalFlow, timeElapsed);

        // Assert
        assertEq(calculatedFee, expectedFee);
    }

    function test_calculateReserveAmountSinceTime_Basic() public {
        // Arrange
        uint112 totalFlow = 10000;
        uint32 timeElapsed = 12;
        uint112 TWAP_FEE = 30; // 0.3%
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
        uint112 totalFlow = uint112(sf.cfa.MAXIMUM_FLOW_RATE());
        uint32 timeElapsed = type(uint32).max;
        uint112 TWAP_FEE = 30; // 0.3%

        uint112 expectedReserveAmount = uint112((uint256(totalFlow) * timeElapsed * (10000 - TWAP_FEE)) / 10000);

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, expectedReserveAmount);
    }

    function testFuzz_calculateReserveAmountSinceTime(uint112 totalFlow, uint32 timeElapsed) public {
        // Arrange
        vm.assume(totalFlow < (sf.cfa.MAXIMUM_FLOW_RATE()));
        uint112 TWAP_FEE = 30; // 0.3%

        uint112 expectedReserveAmount = uint112((uint256(totalFlow) * timeElapsed * (10000 - TWAP_FEE)) / 10000);

        // Act
        uint112 reserveAmount = aqueductV1PairHarness.exposed_calculateReserveAmountSinceTime(totalFlow, timeElapsed);

        // Assert
        assertEq(reserveAmount, expectedReserveAmount);
    }

    function test_calculateReservesBothFlows_Basic() public {
        // Arrange
        uint256 kLast = 1 * 10 ** 36;
        uint112 totalFlow0 = 1 * 10 ** 18;
        uint112 totalFlow1 = 1 * 10 ** 18;
        uint32 timeElapsed = 12;
        uint112 reserve0 = 1 * 10 ** 18;
        uint112 reserve1 = 1 * 10 ** 18;

        uint112 TWAP_FEE = 30; // 0.3%

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
}

contract AqueductV1PairIntegrationTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_mint_liquidity_position() public {
        // Arrange
        uint256 expectedLiquidity = INIT_SUPER_TOKEN_BALANCE;

        vm.startPrank(ADMIN);
        superTokenA.transfer(address(aqueductV1Pair), INIT_SUPER_TOKEN_BALANCE);
        superTokenB.transfer(address(aqueductV1Pair), INIT_SUPER_TOKEN_BALANCE);
        vm.stopPrank();

        // Act
        aqueductV1Pair.mint(ADMIN);

        // Assert
        uint256 totalSupply = aqueductV1Pair.totalSupply();
        assertEq(totalSupply, expectedLiquidity);

        uint256 balanceOf = aqueductV1Pair.balanceOf(ADMIN);
        uint256 expectedBalance = expectedLiquidity - aqueductV1Pair.MINIMUM_LIQUIDITY();
        assertEq(balanceOf, expectedBalance);

        uint256 tokenABalanceOf = superTokenA.balanceOf(address(aqueductV1Pair));
        assertEq(tokenABalanceOf, INIT_SUPER_TOKEN_BALANCE);

        uint256 tokenBBalanceOf = superTokenB.balanceOf(address(aqueductV1Pair));
        assertEq(tokenBBalanceOf, INIT_SUPER_TOKEN_BALANCE);

        (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) = aqueductV1Pair.getReserves();
        assertEq(_reserve0, INIT_SUPER_TOKEN_BALANCE);
        assertEq(_reserve1, INIT_SUPER_TOKEN_BALANCE);
        assertEq(_blockTimestampLast, block.timestamp);
    }

    function test_mint_position_and_provide_liquidity_BROKEN() public {
        uint256 expectedInitialLiquidity = 10 * 10 ** 18;

        {
            uint256 superTokenAAmount = 10 * 10 ** 18;
            uint256 superTokenBAmount = 10 * 10 ** 18;

            vm.startPrank(ADMIN);
            addLiquidity(superTokenA, superTokenB, aqueductV1Pair, ADMIN, superTokenAAmount, superTokenBAmount);
            vm.stopPrank();

            uint256 totalSupply = aqueductV1Pair.totalSupply();
            assertEq(totalSupply, expectedInitialLiquidity);

            (uint112 _reserve0, uint112 _reserve1, uint time) = aqueductV1Pair.getReserves();
            assertEq(_reserve0, superTokenAAmount);
            assertEq(_reserve1, superTokenBAmount);
            assertEq(time, block.timestamp);
        }

        int96 flowRate = 1000000000;

        vm.startPrank(ADMIN);
        sf.host.callAgreement(
            sf.cfa,
            abi.encodeWithSelector(
                sf.cfa.createFlow.selector,
                superTokenA,
                address(aqueductV1Pair),
                flowRate,
                new bytes(0) // placeholder - always pass in bytes(0)
            ),
            "0x" //userData
        );
        vm.stopPrank();

        vm.warp(block.timestamp + 60);

        uint32 latestTime = uint32(block.timestamp);
        uint32 nextBlockTime = latestTime + 10;

        uint256 lpToken0Amount = 1 * 10 ** 18;

        // FIXME: tuple values are the other way round to typescript test because
        // the factory sorts the addresses in ascending order when creating a pair
        (uint112 _reserve1New, uint112 _reserve0New) = aqueductV1Pair.getReservesAtTime(nextBlockTime);

        // calculate correct ratio based on reserves
        uint256 lpToken1Amount = (_reserve1New * lpToken0Amount) / _reserve0New;

        vm.startPrank(ADMIN);
        superTokenA.transfer(address(aqueductV1Pair), lpToken0Amount);
        superTokenB.transfer(address(aqueductV1Pair), lpToken1Amount);
        vm.stopPrank();

        vm.warp(nextBlockTime);

        uint256 expectedNewLiquidity = (lpToken1Amount * expectedInitialLiquidity) / _reserve1New;
        uint256 expectedTotalLiquidity = expectedInitialLiquidity + expectedNewLiquidity;

        aqueductV1Pair.mint(ALICE);

        uint256 newTotalSupply = aqueductV1Pair.totalSupply();
        assertEq(newTotalSupply, expectedTotalLiquidity);

        uint256 aliceBalance = aqueductV1Pair.balanceOf(ALICE);
        assertEq(aliceBalance, expectedNewLiquidity);
    }
}
