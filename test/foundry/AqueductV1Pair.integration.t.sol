// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

//solhint-disable no-global-import
//solhint-disable no-console
//solhint-disable func-name-mixedcase
//solhint-disable var-name-mixedcase

import "forge-std/Test.sol";
import "forge-std/console.sol";
import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";

import {AqueductTester} from "./utils/AqueductTester.sol";

import "forge-std/console2.sol";

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
