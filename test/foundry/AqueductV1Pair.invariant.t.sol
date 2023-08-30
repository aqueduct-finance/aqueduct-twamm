// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

//solhint-disable no-global-import
//solhint-disable no-console
//solhint-disable func-name-mixedcase
//solhint-disable var-name-mixedcase

import {AqueductV1Pair} from "../../src/AqueductV1Pair.sol";
import {AqueductV1Factory} from "../../src/AqueductV1Factory.sol";
import {AqueductTester} from "./utils/AqueductTester.sol";

import {ISuperfluid, ISuperToken} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {SuperTokenV1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol";

import "forge-std/Test.sol";
import "forge-std/console2.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

contract AqueductV1PairHandler is CommonBase, StdCheats, StdUtils {
    using SuperTokenV1Library for ISuperToken;

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

    AqueductV1Pair public aqueductV1Pair;
    AqueductV1Factory public aqueductV1Factory;

    ISuperToken public superTokenA;
    ISuperToken public superTokenB;

    constructor(address _feeToSetter, ISuperfluid _host, address tokenA, address tokenB) {
        aqueductV1Factory = new AqueductV1Factory(_feeToSetter, _host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(tokenA, tokenB));

        superTokenA = ISuperToken(tokenA);
        superTokenB = ISuperToken(tokenB);
    }

    function mint(address to) public returns (uint256 liquidity) {
        aqueductV1Pair.mint(to);
    }

    function burn(address to) public returns (uint256 amount0, uint256 amount1) {
        aqueductV1Pair.burn(to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) public {
        (uint112 totalFlow0, uint112 totalFlow1, uint32 time) = aqueductV1Pair.getRealTimeIncomingFlowRates();
        (uint112 reserve0, uint112 reserve1) = aqueductV1Pair.getReservesAtTime(time);

        amount0Out = bound(amount0Out, 1, reserve0);
        amount1Out = bound(amount1Out, 1, reserve1);
        vm.startPrank(address(aqueductV1Factory));
        aqueductV1Pair.swap(amount0Out, amount1Out, to);
        vm.stopPrank();
    }

    function retrieveFundsTokenA() public returns (uint256 returnedBalance) {
        aqueductV1Pair.retrieveFunds(superTokenA);
    }

    function retrieveFundsTokenB() public returns (uint256 returnedBalance) {
        aqueductV1Pair.retrieveFunds(superTokenB);
    }

    function sync() public {
        aqueductV1Pair.sync();
    }

    function createStreamTokenA(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenA.createFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function createStreamTokenB(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenB.createFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function updateStreamTokenA(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenA.updateFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function updateStreamTokenB(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenB.updateFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function deleteStreamTokenA(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenA.deleteFlow(testAccounts[index], address(aqueductV1Pair));
        vm.stopPrank();
    }

    function deleteStreamTokenB(uint8 index) external {
        index = uint8(bound(uint256(index), uint256(0), uint256(9)));

        vm.startPrank(testAccounts[index]);
        superTokenB.deleteFlow(testAccounts[index], address(aqueductV1Pair));
        vm.stopPrank();
    }
}

contract AqueductV1PairInvariantTest is AqueductTester {
    AqueductV1PairHandler public aqueductV1PairHandler;

    constructor() AqueductTester() {}

    function setUp() public {
        aqueductV1PairHandler = new AqueductV1PairHandler(ADMIN, sf.host, address(superTokenA), address(superTokenB));
        targetContract(address(aqueductV1PairHandler));
    }

    function invariant_x_times_y_equals_k() public {
        // Arrange
        (uint112 staticReserve0, uint112 staticReserve1, ) = aqueductV1PairHandler.aqueductV1Pair().getStaticReserves();
        (uint112 realTimeReserve0, uint112 realTimeReserve1, ) = aqueductV1PairHandler.aqueductV1Pair().getReserves();

        uint256 expectedKLastStaticReserves = staticReserve0 * staticReserve1;
        uint256 expectedKLastRealTimeReserves = realTimeReserve0 * realTimeReserve1;

        // Act
        uint256 kLast = aqueductV1PairHandler.aqueductV1Pair().kLast();

        // Assert
        assertGe(expectedKLastStaticReserves, kLast, "X * Y != K");
        assertGe(expectedKLastRealTimeReserves, kLast, "X * Y != K");
    }
}
