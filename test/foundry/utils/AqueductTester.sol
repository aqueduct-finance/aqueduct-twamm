// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import "forge-std/Test.sol";
import {AqueductV1Pair} from "../../../src/AqueductV1Pair.sol";
import {AqueductV1Factory} from "../../../src/AqueductV1Factory.sol";

import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {SuperfluidFrameworkDeployer, Superfluid, CFAv1Library, IDAv1Library, SuperTokenFactory} from "@superfluid-finance/ethereum-contracts/contracts/utils/SuperfluidFrameworkDeployer.sol";
import {ConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/agreements/ConstantFlowAgreementV1.sol";
import {InstantDistributionAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/agreements/InstantDistributionAgreementV1.sol";
import {ERC1820RegistryCompiled} from "@superfluid-finance/ethereum-contracts/contracts/libs/ERC1820RegistryCompiled.sol";

import {TestGovernance} from "@superfluid-finance/ethereum-contracts/contracts/utils/TestGovernance.sol";
import {TestToken} from "@superfluid-finance/ethereum-contracts/contracts/utils/TestToken.sol";
import {SuperToken} from "@superfluid-finance/ethereum-contracts/contracts/superfluid/SuperToken.sol";

contract AqueductTester is Test {
    AqueductV1Pair public aqueductV1Pair;
    AqueductV1Factory public aqueductV1Factory;
    SuperfluidFrameworkDeployer.Framework internal sf;
    SuperfluidFrameworkDeployer internal deployer;

    TestToken internal underlyingTokenA;
    TestToken internal underlyingTokenB;
    SuperToken internal superTokenA;
    SuperToken internal superTokenB;

    uint256 internal constant INIT_TOKEN_BALANCE = 10000000;
    uint256 internal constant INIT_SUPER_TOKEN_BALANCE = 1000000;

    address internal constant ADMIN = address(0x1);
    address internal constant ALICE = address(0x2);
    address internal constant BOB = address(0x3);
    address internal constant CAROL = address(0x4);
    address internal constant DAN = address(0x5);
    address internal constant EVE = address(0x6);
    address internal constant FRANK = address(0x7);
    address internal constant GRACE = address(0x8);
    address internal constant HEIDI = address(0x9);
    address internal constant IVAN = address(0x10);

    address[] internal testAccounts = [ADMIN, ALICE, BOB, CAROL, DAN, EVE, FRANK, GRACE, HEIDI, IVAN];

    constructor() {
        vm.etch(ERC1820RegistryCompiled.at, ERC1820RegistryCompiled.bin);
        deployer = new SuperfluidFrameworkDeployer();
        deployer.deployTestFramework();
        sf = deployer.getFramework();

        setUpTokens();
    }

    function setUpTokens() public {
        (underlyingTokenA, superTokenA) = deployer.deployWrapperSuperToken(
            "Test Token 0",
            "TT0",
            18,
            INIT_TOKEN_BALANCE
        );
        (underlyingTokenB, superTokenB) = deployer.deployWrapperSuperToken(
            "Test Token 0",
            "TT1",
            18,
            INIT_TOKEN_BALANCE
        );

        for (uint256 i = 0; i < testAccounts.length; ++i) {
            underlyingTokenA.mint(testAccounts[i], INIT_TOKEN_BALANCE);

            vm.startPrank(testAccounts[i]);
            underlyingTokenA.approve(address(superTokenA), INIT_TOKEN_BALANCE);
            superTokenA.upgrade(INIT_SUPER_TOKEN_BALANCE);
            vm.stopPrank();
        }

        for (uint256 i = 0; i < testAccounts.length; ++i) {
            underlyingTokenB.mint(testAccounts[i], INIT_TOKEN_BALANCE);

            vm.startPrank(testAccounts[i]);
            underlyingTokenB.approve(address(superTokenB), INIT_TOKEN_BALANCE);
            superTokenB.upgrade(INIT_SUPER_TOKEN_BALANCE);
            vm.stopPrank();
        }
    }
}
