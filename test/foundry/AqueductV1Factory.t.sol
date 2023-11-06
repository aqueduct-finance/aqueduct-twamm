// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

// solhint-disable no-global-import
// solhint-disable var-name-mixedcase
//solhint-disable no-empty-blocks

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import {IAqueductV1Factory} from "../../src/interfaces/IAqueductV1Factory.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {AqueductTester} from "./utils/AqueductTester.sol";

contract AqueductV1PairTest is AqueductTester {
    constructor() AqueductTester() {}

    function setUp() public {}

    function test_constructor_RevertsIfHostIsZeroAddress() public {
        // Arrange
        address zeroAddress = address(0);

        // Act & Assert
        vm.expectRevert(IAqueductV1Factory.HOST_ZERO_ADDRESS.selector);
        new AqueductV1Factory(ADMIN, ISuperfluid(zeroAddress));
    }
}
