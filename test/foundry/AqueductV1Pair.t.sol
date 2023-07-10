// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import "forge-std/Test.sol";
import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";

import {AqueductTester} from "./utils/AqueductTester.sol";

contract AqueductV1PairTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_getReserves_ReturnsReserves() public {
        // Arrange & Act
        (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast) = aqueductV1Pair.getReserves();

        // Assert
        assertEq(_reserve0, 0);
        assertEq(_reserve1, 0);
        assertEq(_blockTimestampLast, 0);
    }
}

contract AqueductV1PairIntegrationTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_provide_liquidity() public {
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
    }
}
