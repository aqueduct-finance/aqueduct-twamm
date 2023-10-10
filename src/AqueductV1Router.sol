// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

//solhint-disable not-rely-on-time
//solhint-disable var-name-mixedcase
//solhint-disable reason-string

import {ISuperfluid, ISuperToken, ISuperApp, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";
import {IFlowScheduler} from "@superfluid-finance/automation-contracts/scheduler/contracts/interface/IFlowScheduler.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";
import {SuperTokenV1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol";
import {FlowOperatorDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

import {IAqueductV1Factory} from "./interfaces/IAqueductV1Factory.sol";
import {TransferHelper} from "./libraries/TransferHelper.sol";

import {IAqueductV1Router} from "./interfaces/IAqueductV1Router.sol";
import {IAqueductV1Pair} from "./interfaces/IAqueductV1Pair.sol";
import {AqueductV1Library} from "./libraries/AqueductV1Library.sol";
import {IERC20} from "./interfaces/IERC20.sol";

import "hardhat/console.sol";

// contract AqueductV1Router is IAqueductV1Router {
    contract AqueductV1Router is IAqueductV1Router, SuperAppBase {
    using SuperTokenV1Library for ISuperToken;

    address public immutable override factory;

    ISuperfluid public immutable host;
    bytes32 public constant CFA_ID = keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");

    using CFAv1Library for CFAv1Library.InitData;

    CFAv1Library.InitData public cfaV1;
    IConstantFlowAgreementV1 public immutable cfa;
    IFlowScheduler public immutable flowScheduler;

    modifier ensure(uint256 deadline) {
        if (deadline < block.timestamp) revert ROUTER_EXPIRED();
        _;
    }

    // constructor(address _factory, ISuperfluid _host, address _flowScheduler) {
        constructor(address _factory, ISuperfluid _host, address _flowScheduler, string memory _registrationKey) {
        assert(address(_factory) != address(0));
        assert(address(_host) != address(0));
        assert(address(_flowScheduler) != address(0));

        factory = _factory;
        host = _host;
        cfa = IConstantFlowAgreementV1(address(host.getAgreementClass(CFA_ID)));
        cfaV1 = CFAv1Library.InitData(_host, cfa);
        flowScheduler = IFlowScheduler(_flowScheduler);

        // uint256 configWord = SuperAppDefinitions.APP_LEVEL_FINAL |
        //                     SuperAppDefinitions.BEFORE_AGREEMENT_CREATED_NOOP |
        //                     SuperAppDefinitions.BEFORE_AGREEMENT_UPDATED_NOOP |
        //                     SuperAppDefinitions.BEFORE_AGREEMENT_TERMINATED_NOOP;
        // host.registerAppWithKey(configWord, _registrationKey);
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal virtual returns (uint256 amountA, uint256 amountB) {
        // create the pair if it doesn't exist yet
        if (IAqueductV1Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IAqueductV1Factory(factory).createPair(tokenA, tokenB);
        }
        (uint256 reserveA, uint256 reserveB) = AqueductV1Library.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = AqueductV1Library.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert ROUTER_INSUFFICIENT_B_AMOUNT();
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = AqueductV1Library.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                if (amountAOptimal < amountAMin) revert ROUTER_INSUFFICIENT_A_AMOUNT();
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external virtual override ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = AqueductV1Library.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IAqueductV1Pair(pair).mint(to);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public virtual override ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = AqueductV1Library.pairFor(factory, tokenA, tokenB);
        IAqueductV1Pair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair
        (uint256 amount0, uint256 amount1) = IAqueductV1Pair(pair).burn(to);
        (address token0, ) = AqueductV1Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        if (amountA < amountAMin) revert ROUTER_INSUFFICIENT_A_AMOUNT();
        if (amountB < amountBMin) revert ROUTER_INSUFFICIENT_B_AMOUNT();
    }

    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual override returns (uint256 amountA, uint256 amountB) {
        address pair = AqueductV1Library.pairFor(factory, tokenA, tokenB);
        uint256 value = approveMax ? type(uint256).max : liquidity;
        IAqueductV1Pair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }

    uint256 public streamScheduleMinimumFee = 1 ether; // 1 MATIC

    // TODO: add permissions
    function setStreamScheduleMinimumFee(uint256 fee) public {
        streamScheduleMinimumFee = fee;
    }

    error ROUTER_STREAM_FEE_TOO_LOW();
    error PAIR_SUPPORT_ONLY_ONE_HOST();

    function calculateFee(address superToken, address sender, uint256 endDate, int96 inflowRate) internal {
        uint256 currentTimestamp = block.timestamp;
        uint256 streamDuration = endDate - currentTimestamp;
        uint256 feeFlowRate = (uint256(uint96(inflowRate)) * 100) / 10000; // 1%

        if (feeFlowRate * streamDuration < streamScheduleMinimumFee) {
            revert ROUTER_STREAM_FEE_TOO_LOW();
        }

        // (bool success, bytes memory data) =
        // superToken.call(abi.encodeWithSelector(IERC20.transferFrom.selector, address(this), value));
        // if (!success && (data.length != 0 || !abi.decode(data, (bool)))) revert PAIR_TRANSFER_FAILED();
    }

    // **** STREAM SCHEDULING FUNCTIONS ****
    function createFlowSchedule(address superToken, address sender, uint256 endDate, address pairAddress, int96 inflowRate) public {
        if (endDate <= block.timestamp) revert STREAM_END_DATE_BEFORE_NOW();

        calculateFee(superToken, sender, endDate, inflowRate);

        // console.log("about to grant permissions");
        // // _grantFlowOperatorPermissions(superToken, address(flowScheduler));
        // host.callAgreement(
        //     cfa,
        //     abi.encodeCall(
        //         cfa.updateFlowOperatorPermissions,
        //         (
        //             ISuperToken(superToken),
        //             address(flowScheduler),
        //             FlowOperatorDefinitions.AUTHORIZE_FULL_CONTROL,
        //             type(int96).max,
        //             new bytes(0)
        //         )
        //     ),
        //     new bytes(0)
        // );
        // console.log("Permissions granted");

        // bytes memory userData = abi.encode(sender);

        // host.callAppActionWithContext(
        //     ISuperApp(address(flowScheduler)),
        //     abi.encodeCall(
        //         flowScheduler.createFlowSchedule,
        //         (
        //             ISuperToken(superToken),
        //             pairAddress, // stream receiver
        //             uint32(0), // start date
        //             uint32(0), // start date max delay
        //             int96(0), // flow rate
        //             uint256(0), // start amount
        //             uint32(endDate),
        //             userData,
        //             new bytes(0)
        //         )
        //     ),
        //     new bytes(0)
        // );

        // flowScheduler.createFlowSchedule(
        //     ISuperToken(superToken),
        //     pairAddress, // stream receiver
        //     uint32(0), // start date
        //     uint32(0), // start date max delay
        //     int96(0), // flow rate
        //     uint256(0), // start amount
        //     uint32(endDate),
        //     userData,
        //     new bytes(0)
        // );
    }

    /**
     * @param flowSuperToken Super token address
     * @param flowOperator The permission grantee address
     */
    // function _grantFlowOperatorPermissions(address flowSuperToken, address flowOperator) internal {
    //     host.callAgreement(
    //         cfa,
    //         abi.encodeCall(
    //             cfa.updateFlowOperatorPermissions,
    //             (
    //                 ISuperToken(flowSuperToken),
    //                 flowOperator,
    //                 4, // bitmask representation of delete
    //                 0, // flow rate allowance
    //                 new bytes(0) // ctx
    //             )
    //         ),
    //         // "0x"
    //         new bytes(0)
    //     );
    // }
    function _grantFlowOperatorPermissions(address flowSuperToken, address flowOperator) internal {
        host.callAgreement(
            cfa,
            abi.encodeCall(
                cfa.updateFlowOperatorPermissions,
                (
                    ISuperToken(flowSuperToken),
                    flowOperator,
                    FlowOperatorDefinitions.AUTHORIZE_FULL_CONTROL,
                    type(int96).max,
                    new bytes(0)
                )
            ),
            new bytes(0)
        );
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(
        uint256 amountA,
        uint256 reserveA,
        uint256 reserveB
    ) public pure virtual override returns (uint256 amountB) {
        return AqueductV1Library.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure virtual override returns (uint256 amountOut) {
        return AqueductV1Library.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut
    ) public pure virtual override returns (uint256 amountIn) {
        return AqueductV1Library.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(
        uint256 amountIn,
        address[] memory path
    ) public view virtual override returns (uint256[] memory amounts) {
        return AqueductV1Library.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(
        uint256 amountOut,
        address[] memory path
    ) public view virtual override returns (uint256[] memory amounts) {
        return AqueductV1Library.getAmountsIn(factory, amountOut, path);
    }

    function _handleCallback(ISuperToken _superToken, bytes memory _ctx) internal returns (int96, address) {
        ISuperfluid.Context memory context = host.decodeCtx(_ctx);
        (uint256 endDate, address pair) = abi.decode(context.userData, (uint256, address));
        int96 inflowRate = _superToken.getFlowRate(context.msgSender, address(this));

        if (endDate != 0) {
            createFlowSchedule(address(_superToken), context.msgSender, endDate, pair, inflowRate);
        }

        return ((inflowRate * 99), pair);
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, //_agreementId
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        (int96 newFlowRate, address pair) = _handleCallback(_superToken, newCtx);
        newCtx = _ctx;

        // TODO: manage accounting for fees in this contract
        // if (_superToken.getFlowRate(address(this), pair) == 0) {
        //     console.log(2);
        //     newCtx = _superToken.createFlowWithCtx(pair, newFlowRate, newCtx);
        // } else {
        //     newCtx = _superToken.updateFlowWithCtx(pair, newFlowRate, newCtx);
        // }
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        // Ensure check is done on fee otherwise user could update stream to lower amount and
        newCtx = _ctx;
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        // Ensure doesn't revert
        // cancel stream schedule
        newCtx = _ctx;
    }

    modifier onlyHost() {
        if (msg.sender != address(cfaV1.host)) revert PAIR_SUPPORT_ONLY_ONE_HOST();
        _;
    }
}
