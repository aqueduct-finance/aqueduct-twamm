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

    AqueductV1Pair public aqueductV1Pair;
    AqueductV1Factory public aqueductV1Factory;

    constructor(address _feeToSetter, ISuperfluid _host, address tokenA, address tokenB) {
        aqueductV1Factory = new AqueductV1Factory(_feeToSetter, _host);
        aqueductV1Pair = AqueductV1Pair(aqueductV1Factory.createPair(tokenA, tokenB));
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
        aqueductV1Pair.swap(amount0Out, amount1Out, to);
    }

    function retrieveFunds(ISuperToken superToken) public returns (uint256 returnedBalance) {
        aqueductV1Pair.retrieveFunds(superToken);
    }

    function sync() public {
        aqueductV1Pair.sync();
    }

    function createStream(ISuperToken superToken, address account) external {
        vm.startPrank(account);
        superToken.createFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function updateStream(ISuperToken superToken, address account) external {
        vm.startPrank(account);
        superToken.updateFlow(address(aqueductV1Pair), 1 * 10 ** 18);
        vm.stopPrank();
    }

    function deleteStream(ISuperToken superToken, address account) external {
        vm.startPrank(account);
        superToken.deleteFlow(account, address(aqueductV1Pair));
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
        (uint112 reserve0, uint112 reserve1, ) = aqueductV1PairHandler.aqueductV1Pair().getStaticReserves();
        uint256 expectedKLast = reserve0 * reserve1;

        // Act
        uint256 kLast = aqueductV1PairHandler.aqueductV1Pair().kLast();

        // Assert
        assertEq(kLast, expectedKLast, "X * Y != K");
    }
}
