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

import {UQ112x112} from "../../src/libraries/UQ112x112.sol";
import {Math} from "../../src/libraries/Math.sol";
import {AqueductTester} from "./utils/AqueductTester.sol";

import "forge-std/console2.sol";

contract AqueductV1PairTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1Factory = new AqueductV1Factory(ADMIN, sf.host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(address(superTokenA), address(superTokenB)));
    }

    function test_initialize_RevertsIfFactoryIsNotSender() public {
        // Arrange & Act & Assert
        vm.expectRevert(IAqueductV1Pair.PAIR_FORBIDDEN.selector);
        aqueductV1Pair.initialize(superTokenA, superTokenB, sf.host);
    }
}
