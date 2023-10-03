// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

import {IAqueductV1Pair} from "./interfaces/IAqueductV1Pair.sol";
import {IAqueductV1Factory} from "./interfaces/IAqueductV1Factory.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {ISuperfluid, ISuperToken, ISuperfluidToken, ISuperApp, ISuperAgreement, SuperAppDefinitions} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";
import {IConstantFlowAgreementV1} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import {Math} from "./libraries/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {UQ160x96} from "./libraries/UQ160x96.sol";
import {CFAv1Library} from "@superfluid-finance/ethereum-contracts/contracts/apps/CFAv1Library.sol";

import {AqueductV1ERC20} from "./AqueductV1ERC20.sol";
import {SuperAppBase} from "@superfluid-finance/ethereum-contracts/contracts/apps/SuperAppBase.sol";

//solhint-disable func-name-mixedcase
//solhint-disable avoid-low-level-calls
//solhint-disable not-rely-on-time

/**
 * @title AqueductV1Pair contract
 * @author Aqueduct
 */
contract AqueductV1Pair is IAqueductV1Pair, AqueductV1ERC20, SuperAppBase {
    using UQ160x96 for uint256;

    uint256 public constant override MINIMUM_LIQUIDITY = 10 ** 3;
    uint112 public constant TWAP_FEE = 30; // basis points

    address public immutable override factory;
    ISuperToken public override token0;
    ISuperToken public override token1;

    uint112 private _reserve0; // uses single storage slot, accessible via getReserves
    uint112 private _reserve1; // uses single storage slot, accessible via getReserves
    uint32 private _blockTimestampLast; // uses single storage slot, accessible via getReserves

    uint256 public override kLast; // _reserve0 * _reserve1, as of immediately after the most recent liquidity event

    // for TWAP balance tracking (use _blockTimestampLast)
    uint256 public twap0CumulativeLast;
    uint256 public twap1CumulativeLast;
    mapping(address => uint256) public userStartingCumulatives0;
    mapping(address => uint256) public userStartingCumulatives1;
    uint112 private _totalSwappedFunds0;
    uint112 private _totalSwappedFunds1;

    // superfluid
    using CFAv1Library for CFAv1Library.InitData;
    CFAv1Library.InitData public cfaV1;
    bytes32 public constant CFA_ID = keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    IConstantFlowAgreementV1 public cfa;

    uint256 private unlocked = 1;

    constructor() {
        factory = msg.sender;
    }

    /**
     * @notice Initializes the contract with two super tokens. Called only once by the factory at the time of
     *         deployment.
     * @dev This function can only be called by the factory. If called by any other address, it will revert
     *      with "PAIR_FORBIDDEN".
     * @param _token0 The first token in the pair.
     * @param _token1 The second token in the pair.
     * @param _host the superfluid host contract
     */
    function initialize(ISuperToken _token0, ISuperToken _token1, ISuperfluid _host) external override {
        if (msg.sender != factory) revert PAIR_FORBIDDEN(); // sufficient check
        token0 = _token0;
        token1 = _token1;

        // init cfa
        cfa = IConstantFlowAgreementV1(address(_host.getAgreementClass(CFA_ID)));
        cfaV1 = CFAv1Library.InitData(_host, cfa);
    }

    /**
     * @notice Fetches the real-time incoming flow rates for both tokens and the current timestamp.
     * @dev This function calls the `getNetFlow` method from `cfa` contract for each token and gets the
     *      current block timestamp.
     * @return totalFlow0 The total incoming flow rate for `token0`.
     * @return totalFlow1 The total incoming flow rate for `token1`.
     * @return time The current block timestamp modulo 2**32.
     */
    function getRealTimeIncomingFlowRates()
        public
        view
        override
        returns (uint96 totalFlow0, uint96 totalFlow1, uint32 time)
    {
        totalFlow0 = uint96(cfa.getNetFlow(token0, address(this)));
        totalFlow1 = uint96(cfa.getNetFlow(token1, address(this)));
        time = uint32(block.timestamp % 2 ** 32);
    }

    /**************************************************************************
     * Reserves Functions & Internal Reserves Helper Functions
     *************************************************************************/

    /**
     * @notice Fetches the current reserves and the last recorded block timestamp.
     * @dev This function returns the current values of `_reserve0`, `_reserve1`, and `_blockTimestampLast`.
     * @return reserve0 The current reserve of `token0`.
     * @return reserve1 The current reserve of `token1`.
     * @return blockTimestampLast The timestamp of the last block when reserves were updated.
     */
    function getStaticReserves()
        public
        view
        override
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)
    {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        blockTimestampLast = _blockTimestampLast;
    }

    /**
     * @notice Fetches the real-time reserves.
     * @dev This function fetches the reserves at the current block timestamp.
     * @return reserve0 The real-time reserve of token0.
     * @return reserve1 The real-time reserve of token1.
     * @return time The current block timestamp.
     */
    function getReserves() public view override returns (uint112 reserve0, uint112 reserve1, uint32 time) {
        time = uint32(block.timestamp % 2 ** 32);
        (reserve0, reserve1) = getReservesAtTime(time);
    }

    /**
     * @notice Fetches the reserves at a given timestamp. Intended to be used externally
     * @dev This function calculates the reserves of both tokens at a given time by getting the net flow of both tokens.
     * @param time The timestamp at which the reserves are to be fetched.
     * @return reserve0 The reserve of token0 at the specified time.
     * @return reserve1 The reserve of token1 at the specified time.
     */
    function getReservesAtTime(uint32 time) public view override returns (uint112 reserve0, uint112 reserve1) {
        uint112 totalFlow0 = uint112(uint96(cfa.getNetFlow(token0, address(this))));
        uint112 totalFlow1 = uint112(uint96(cfa.getNetFlow(token1, address(this))));
        (reserve0, reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
    }

    /**
     * @notice Calculates the reserves at a specified timestamp.
     * @dev This function uses total flows and fees to calculate the reserves at a given timestamp.
     *      It first fetches the reserves without fees and then applies the necessary fees based on total flows.
     * @param time The timestamp at which the reserves are to be calculated.
     * @param totalFlow0 The total flow of token0.
     * @param totalFlow1 The total flow of token1.
     * @return reserve0 The calculated reserve of token0 at the specified time.
     * @return reserve1 The calculated reserve of token1 at the specified time.
     */
    function _getReservesAtTime(
        uint32 time,
        uint112 totalFlow0,
        uint112 totalFlow1
    ) internal view returns (uint112 reserve0, uint112 reserve1) {
        uint32 timeElapsed = time - _blockTimestampLast;
        uint256 _kLast = uint256(_reserve0) * _reserve1;

        if (totalFlow0 > 0 && totalFlow1 > 0 && timeElapsed > 0) {
            (reserve0, reserve1) = _calculateReservesBothFlows(
                _kLast,
                totalFlow0,
                totalFlow1,
                timeElapsed,
                _reserve0,
                _reserve1
            );
        } else if (totalFlow0 > 0 && timeElapsed > 0) {
            (reserve0, reserve1) = _calculateReservesFlow0(_kLast, totalFlow0, timeElapsed, _reserve0);
        } else if (totalFlow1 > 0 && timeElapsed > 0) {
            (reserve0, reserve1) = _calculateReservesFlow1(_kLast, totalFlow1, timeElapsed, _reserve1);
        } else {
            // get static reserves
            (reserve0, reserve1, ) = getStaticReserves();
        }

        // add fees accumulated since last reserve update
        if (totalFlow0 > 0) {
            reserve0 += _calculateFees(totalFlow0, timeElapsed);
        }
        if (totalFlow1 > 0) {
            reserve1 += _calculateFees(totalFlow1, timeElapsed);
        }
    }

    /**
     * @notice Calculates the fees accumulated over a period of time.
     * @dev This function calculates the fees accumulated on a total flow over the time elasped.
     * @param totalFlow The total flow of the token.
     * @param timeElapsed The time period over which the fees are to be calculated.
     * @return fees calculated fees.
     */
    function _calculateFees(uint112 totalFlow, uint32 timeElapsed) internal pure returns (uint112 fees) {
        uint256 overflowResistantCalc = (uint256(totalFlow) * timeElapsed * TWAP_FEE) / 10000;
        fees = SafeCast.toUint112(overflowResistantCalc);
    }

    /**
     * @notice Calculates the reserve amount since the last update time after applying fees.
     * @dev This function uses the total flow, elapsed time and the TWAP_FEE to calculate
     *      the updated reserve amount.
     * @param totalFlow The total flow of the token.
     * @param timeElapsed The time elapsed since the last update.
     * @return reserveAmountSinceTime calculated reserve amount after applying fees.
     */
    function _calculateReserveAmountSinceTime(
        uint112 totalFlow,
        uint32 timeElapsed
    ) internal pure returns (uint112 reserveAmountSinceTime) {
        uint256 overflowResistantCalc = (uint256(totalFlow) * timeElapsed * (10000 - TWAP_FEE)) / 10000;
        reserveAmountSinceTime = SafeCast.toUint112(overflowResistantCalc);
    }

    /**
     * @notice Calculates reserves when both flows exist.
     * @dev Reserves are calculated based on the invariant (_kLast) and updated flows.
     * @param _kLast The previous product of the reserves (currentReserve0 * currentReserve1).
     * @param totalFlow0 Total flow of token0.
     * @param totalFlow1 Total flow of token1.
     * @param timeElapsed Time elapsed since the last update.
     * @param currentReserve0 The current reserve of token0.
     * @param currentReserve1 The current reserve of token1.
     * @return reserve0 The calculated reserve of token0.
     * @return reserve1 The calculated reserve of token1.
     */
    function _calculateReservesBothFlows(
        uint256 _kLast,
        uint112 totalFlow0,
        uint112 totalFlow1,
        uint32 timeElapsed,
        uint112 currentReserve0,
        uint112 currentReserve1
    ) internal pure returns (uint112 reserve0, uint112 reserve1) {
        // use approximation:
        // reserve0 = sqrt( k * (reserve0 + totalAmountStreamed0) / (reserve1 + totalAmountStreamed1) )
        uint112 reserveAmountSinceTime0 = _calculateReserveAmountSinceTime(totalFlow0, timeElapsed);
        uint112 reserveAmountSinceTime1 = _calculateReserveAmountSinceTime(totalFlow1, timeElapsed);

        // if totalFlow1 is larger than totalFlow0, need to calculate
        // reserve1 first to prevent reserve0 from possibly evaluating to 0
        if (totalFlow0 > totalFlow1) {
            uint256 result = _overflowResistantReserveCalc(
                _kLast,
                currentReserve0 + reserveAmountSinceTime0,
                currentReserve1 + reserveAmountSinceTime1
            );
            reserve0 = SafeCast.toUint112(Math.sqrt(result));
            reserve1 = SafeCast.toUint112(_kLast / reserve0);
        } else {
            uint256 result = _overflowResistantReserveCalc(
                _kLast,
                currentReserve1 + reserveAmountSinceTime1,
                currentReserve0 + reserveAmountSinceTime0
            );
            reserve1 = SafeCast.toUint112(Math.sqrt(result));
            reserve0 = SafeCast.toUint112(_kLast / reserve1);
        }
    }

    /**
     * @dev computes a * b / c in a way that is overflow resistant
     */
    function _overflowResistantReserveCalc(uint256 a, uint256 b, uint256 c) internal pure returns (uint256 result) {
        uint256 q1 = a / c;
        uint256 r1 = a % c;
        uint256 q2 = b / c;
        uint256 r2 = b % c;

        result = q1 * b;
        result += r1 * q2;
        result += (r1 * r2) / c;
    }

    /**
     * @notice Calculates reserves when only flow0 exists.
     * @dev Uses invariant x * y = k to calculate the reserves when only flow0 is active.
     *      The total amount of token0 is calculated after fee and added to the current reserves.
     *      Downcasting uint256 to uint112 should be safe in this context.
     * @param _kLast The previous product of the reserves (currentReserve0 * currentReserve1).
     * @param totalFlow0 Total flow of token0.
     * @param timeElapsed Time elapsed since the last update.
     * @param currentReserve0 The current reserve of token0.
     * @return reserve0 The calculated reserve of token0.
     * @return reserve1 The calculated reserve of token1.
     */
    function _calculateReservesFlow0(
        uint256 _kLast,
        uint112 totalFlow0,
        uint32 timeElapsed,
        uint112 currentReserve0
    ) internal pure returns (uint112 reserve0, uint112 reserve1) {
        // use x * y = k
        uint112 reserveAmountSinceTime0 = _calculateReserveAmountSinceTime(totalFlow0, timeElapsed);
        reserve0 = currentReserve0 + reserveAmountSinceTime0;
        reserve1 = SafeCast.toUint112(_kLast / reserve0); // should be a safe downcast
    }

    /**
     * @notice Calculates reserves when only flow1 exists.
     * @dev Uses invariant x * y = k to calculate the reserves when only flow1 is active.
     *      The total amount of token1 is calculated after fee and added to the current reserves.
     *      Downcasting uint256 to uint112 should be safe in this context.
     * @param _kLast The previous product of the reserves (currentReserve0 * currentReserve1).
     * @param totalFlow1 Total flow of token1.
     * @param timeElapsed Time elapsed since the last update.
     * @param currentReserve1 The current reserve of token1.
     * @return reserve0 The calculated reserve of token0.
     * @return reserve1 The calculated reserve of token1.
     */
    function _calculateReservesFlow1(
        uint256 _kLast,
        uint112 totalFlow1,
        uint32 timeElapsed,
        uint112 currentReserve1
    ) internal pure returns (uint112 reserve0, uint112 reserve1) {
        // use x * y = k
        uint112 reserveAmountSinceTime1 = _calculateReserveAmountSinceTime(totalFlow1, timeElapsed);
        reserve1 = currentReserve1 + reserveAmountSinceTime1;
        reserve0 = SafeCast.toUint112(_kLast / reserve1); // should be a safe downcast
    }

    /**************************************************************************
     * Cumulatives Functions & Internal Cumulatives Helper Functions
     *************************************************************************/

    /**
     * @notice Calculates the updated time-weighted average price (TWAP) cumulative values for `token0` and
     * `token1` given the reserves, net flows and a specific time.
     * @param time The timestamp at which to get the updated TWAP.
     * @param reserve0 The reserve amount of token0.
     * @param reserve1 The reserve amount of token1.
     * @param totalFlow0 The total flow of token0.
     * @param totalFlow1 The total flow of token1.
     * @return _twap0CumulativeLast The calculated cumulative TWAP of token0.
     * @return _twap1CumulativeLast The calculated cumulative TWAP of token1.
     */
    function _getUpdatedCumulatives(
        uint32 time,
        uint112 reserve0,
        uint112 reserve1,
        uint96 totalFlow0,
        uint96 totalFlow1
    ) internal view returns (uint256 _twap0CumulativeLast, uint256 _twap1CumulativeLast) {
        uint32 timeElapsed = time - _blockTimestampLast;
        _twap0CumulativeLast = twap0CumulativeLast;
        _twap1CumulativeLast = twap1CumulativeLast;

        if (totalFlow1 > 0) {
            _twap0CumulativeLast += UQ160x96.encode((uint160(totalFlow0) * timeElapsed) + _reserve0 - reserve0).uqdiv(totalFlow1);
        }
        if (totalFlow0 > 0) {
            _twap1CumulativeLast += UQ160x96.encode((uint160(totalFlow1) * timeElapsed) + _reserve1 - reserve1).uqdiv(totalFlow0);
        }
    }

    /**************************************************************************
     * Balance Functions
     *************************************************************************/

    /**
     * @notice Returns the real-time balance of the specified user for both tokens along with the current timestamp.
     * @param user Address of the user whose balances are being queried.
     * @return balance0 Real-time balance of the user for `token0`.
     * @return balance1 Real-time balance of the user for `token1`.
     * @return time The current block timestamp.
     */
    function getRealTimeUserBalances(
        address user
    ) public view override returns (uint256 balance0, uint256 balance1, uint256 time) {
        (balance0, balance1) = getUserBalancesAtTime(user, uint32(block.timestamp % 2 ** 32));
        time = block.timestamp;
    }

    /**
     * @notice Calculates and returns the balance of the specified user for both tokens at a specific time.
     * @param user Address of the user whose balances are being queried.
     * @param time The specific time for which the balances are being queried.
     * @return balance0 User's balance for `token0` at the specified time.
     * @return balance1 User's balance for `token1` at the specified time.
     */
    function getUserBalancesAtTime(
        address user,
        uint32 time
    ) public view override returns (uint256 balance0, uint256 balance1) {
        uint96 totalFlow0 = uint96(cfa.getNetFlow(token0, address(this)));
        uint96 totalFlow1 = uint96(cfa.getNetFlow(token1, address(this)));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));
        (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
        (balance0, balance1) = _getUserBalancesAtTime(
            user,
            time,
            reserve0,
            reserve1,
            totalFlow0,
            totalFlow1,
            flow0,
            flow1
        );
    }

    /**
     * @notice Helper function to compute the balance of the user at a specific time for both tokens using the provided parameters.
     * @param user Address of the user whose balances are being computed.
     * @param time The specific time for which the balances are being computed.
     * @param reserve0 The reserve of `token0` at the given time.
     * @param reserve1 The reserve of `token1` at the given time.
     * @param totalFlow0 The net flow of `token0` for the contract.
     * @param totalFlow1 The net flow of `token1` for the contract.
     * @param flow0 The flow rate of `token0` for the user.
     * @param flow1 The flow rate of `token1` for the user.
     * @return balance0 Computed balance of the user for `token0` at the specified time.
     * @return balance1 Computed balance of the user for `token1` at the specified time.
     */
    function _getUserBalancesAtTime(
        address user,
        uint32 time,
        uint112 reserve0,
        uint112 reserve1,
        uint96 totalFlow0,
        uint96 totalFlow1,
        int96 flow0,
        int96 flow1
    ) internal view returns (uint256 balance0, uint256 balance1) {
        (uint256 _twap0CumulativeLast, uint256 _twap1CumulativeLast) = _getUpdatedCumulatives(
            time,
            reserve0,
            reserve1,
            totalFlow0,
            totalFlow1
        );

        // flow in is always positive

        balance0 = UQ160x96.decode(uint256(uint96(flow1)) * (_twap0CumulativeLast - userStartingCumulatives0[user]));
        balance1 = UQ160x96.decode(uint256(uint96(flow0)) * (_twap1CumulativeLast - userStartingCumulatives1[user]));
    }

    /**************************************************************************
     * Internal Accumulator Helper Functions
     *************************************************************************/

    /**
     * @notice Update reserves and, on the first call per block, updates the price accumulators.
     * @dev This function checks if the block timestamp has increased since the last update,
     *      and if so, updates the price cumulatives for each token based on the provided reserves.
     *      It also updates TWAP cumulatives if there's any flow for tokens.
     * @param reserve0 The current reserve of `token0`.
     * @param reserve1 The current reserve of `token1`.
     * @param totalFlow0 The total net flow rate of `token0` for the contract.
     * @param totalFlow1 The total net flow rate of `token1` for the contract.
     * @param time The specific time when this function is invoked.
     */
    function _updateAccumulators(
        uint112 reserve0,
        uint112 reserve1,
        uint96 totalFlow0,
        uint96 totalFlow1,
        uint32 time
    ) private {
        uint32 timeElapsedSinceInputTime = time - _blockTimestampLast;

        // update cumulatives
        // assuming reserve{0,1} are real time
        if (totalFlow1 > 0) {
            twap0CumulativeLast += _getTwapCumulative(
                reserve0,
                _reserve0,
                totalFlow0,
                totalFlow1,
                timeElapsedSinceInputTime
            );
            uint112 streamedAmount0 = totalFlow0 > 0 ? totalFlow0 * timeElapsedSinceInputTime : 0;
            _totalSwappedFunds0 += streamedAmount0 + _reserve0 - reserve0;
        }
        if (totalFlow0 > 0) {
            twap1CumulativeLast += _getTwapCumulative(
                reserve1,
                _reserve1,
                totalFlow1,
                totalFlow0,
                timeElapsedSinceInputTime
            );
            uint112 streamedAmount1 = totalFlow1 > 0 ? totalFlow1 * timeElapsedSinceInputTime : 0;
            _totalSwappedFunds1 += streamedAmount1 + _reserve1 - reserve1;
        }
    }

    /**
     * @notice Calculate the TWAP cumulative for a specific token reserve over an elapsed time.
     * @param newReserve The new reserve value of the token.
     * @param storedReserve The stored reserve value of the token.
     * @param totalFlow The total net flow rate of the token for the contract.
     * @param totalFlowDenominator The total net flow rate of the other token.
     * @param timeElapsed The time duration over which the TWAP cumulative is computed.
     * @return twapCumulative The computed TWAP cumulative over the provided time duration.
     */
    function _getTwapCumulative(
        uint112 newReserve,
        uint112 storedReserve,
        uint96 totalFlow,
        uint96 totalFlowDenominator,
        uint32 timeElapsed
    ) internal pure returns (uint256 twapCumulative) {
        twapCumulative = UQ160x96.encode((uint160(totalFlow) * timeElapsed) + storedReserve - newReserve).uqdiv(totalFlowDenominator);
    }

    /**************************************************************************
     * AMM "actions" Functions & Internal AMM "actions" Helper Functions
     *************************************************************************/

    /**
     * @notice Mint liquidity to the AMM pool in exchange for an amount of token0 and token1.
     * @dev This function should only be called from a contract which performs important safety checks.
     *      It first retrieves the real-time flow rates, updates the accumulators, then mints the
     *      appropriate amount of liquidity tokens to the recipient.
     * @param to The address to receive the minted liquidity tokens.
     * @return liquidity The amount of liquidity tokens minted.
     */
    function mint(address to) external override lock returns (uint256 liquidity) {
        (uint96 totalFlow0, uint96 totalFlow1, uint32 time) = getRealTimeIncomingFlowRates();
        (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
        _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);

        uint256 balance0 = token0.balanceOf(address(this)) - _totalSwappedFunds0;
        uint256 balance1 = token1.balanceOf(address(this)) - _totalSwappedFunds1;

        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;

        bool feeOn = _mintFee(reserve0, reserve1);

        // gas savings, must be defined here since totalSupply can update in _mintFee
        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY;
            _mint(address(0), MINIMUM_LIQUIDITY); // permanently lock the first MINIMUM_LIQUIDITY tokens
        } else {
            liquidity = calculateLiquidity(amount0, amount1, reserve0, reserve1, _totalSupply);
        }
        if (liquidity <= 0) revert PAIR_INSUFFICIENT_LIQUIDITY_MINTED();
        _mint(to, liquidity);

        _updateReserves(balance0, balance1, time);
        if (feeOn) kLast = uint256(_reserve0) * _reserve1; // _reserve0 and _reserve1 are up-to-date
        emit Mint(msg.sender, amount0, amount1);
    }

    /**
     * @notice Calculate the amount of liquidity that can be minted given amounts of token0 and token1.
     * @dev This function calculates the minimal liquidity given the amount of each token and the
     *      total supply of liquidity.
     * @param amount0 The amount of `token0` being provided for liquidity.
     * @param amount1 The amount of `token1` being provided for liquidity.
     * @param reserve0 The current reserve of `token0` in the pool.
     * @param reserve1 The current reserve of `token1` in the pool.
     * @param totalSupply The total supply of liquidity tokens in the pool.
     * @return liquidity amount of liquidity tokens that can be minted.
     */
    function calculateLiquidity(
        uint256 amount0,
        uint256 amount1,
        uint112 reserve0,
        uint112 reserve1,
        uint256 totalSupply
    ) internal pure returns (uint256 liquidity) {
        liquidity = Math.min((amount0 * totalSupply) / reserve0, (amount1 * totalSupply) / reserve1);
    }

    /**
     * @notice Burn liquidity from the AMM pool to redeem an amount of token0 and token1.
     * @dev This function should only be called from a contract which performs important safety checks.
     *      It redeems the liquidity tokens from the pool and sends the proportional amount of
     *      `token0` and `token1` to the specified address.
     * @param to The address to receive the redeemed `token0` and `token1`.
     * @return amount0 The amount of `token0` redeemed.
     * @return amount1 The amount of `token1` redeemed.
     */
    function burn(address to) external override lock returns (uint256 amount0, uint256 amount1) {
        address _token0 = address(token0); // gas savings
        address _token1 = address(token1); // gas savings
        uint256 liquidity = balanceOf[address(this)];
        uint32 time;
        uint256 balance0;
        uint256 balance1;
        uint256 totalSwappedFunds0;
        uint256 totalSwappedFunds1;
        bool feeOn;
        {
            // scope for _reserve{0,1} and totalFlow{0,1}, avoids stack too deep errors
            uint96 totalFlow0;
            uint96 totalFlow1;
            (totalFlow0, totalFlow1, time) = getRealTimeIncomingFlowRates();
            (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
            _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);

            totalSwappedFunds0 = _totalSwappedFunds0; // gas savings
            totalSwappedFunds1 = _totalSwappedFunds1;
            balance0 = IERC20(_token0).balanceOf(address(this)) - totalSwappedFunds0;
            balance1 = IERC20(_token1).balanceOf(address(this)) - totalSwappedFunds1;

            feeOn = _mintFee(reserve0, reserve1);
        }

        // gas savings, must be defined here since totalSupply can update in _mintFee
        uint256 _totalSupply = totalSupply;
        amount0 = (liquidity * balance0) / _totalSupply; // using balances ensures pro-rata distribution
        amount1 = (liquidity * balance1) / _totalSupply; // using balances ensures pro-rata distribution
        if (amount0 <= 0 || amount1 <= 0) revert PAIR_INSUFFICIENT_LIQUIDITY_BURNED();
        _burn(address(this), liquidity);
        _safeTransfer(_token0, to, amount0);
        _safeTransfer(_token1, to, amount1);
        balance0 = IERC20(_token0).balanceOf(address(this)) - totalSwappedFunds0;
        balance1 = IERC20(_token1).balanceOf(address(this)) - totalSwappedFunds1;

        _updateReserves(balance0, balance1, time);
        if (feeOn) kLast = uint256(_reserve0) * _reserve1; // _reserve0 and _reserve1 are up-to-date
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /**
     * @notice Swap tokens for the desired amounts.
     * @dev This low-level function can only be called from the auction contract, which performs important safety checks
     * @param amount0Out The amount of token0 to be swapped.
     * @param amount1Out The amount of token1 to be swapped.
     * @param to The recipient address of the swapped tokens.
     */
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external override lock {
        if (msg.sender != address(IAqueductV1Factory(factory).auction())) revert PAIR_FORBIDDEN();
        if (amount0Out <= 0 && amount1Out <= 0) revert PAIR_INSUFFICIENT_OUTPUT_AMOUNT();

        uint256 amount0In;
        uint256 amount1In;
        {
            uint32 time;
            uint112 reserve0;
            uint112 reserve1;
            {
                // group real-time read operations for gas savings
                uint96 totalFlow0;
                uint96 totalFlow1;
                (totalFlow0, totalFlow1, time) = getRealTimeIncomingFlowRates();
                (reserve0, reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
                _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);
            }

            if (amount0Out >= reserve0 || amount1Out >= reserve1) revert PAIR_INSUFFICIENT_LIQUIDITY();

            // scope for _token{0,1}, avoids stack too deep errors
            address _token0 = address(token0);
            address _token1 = address(token1);
            if (to == _token0 || to == _token1) revert PAIR_INVALID_TO();
            if (amount0Out > 0) _safeTransfer(_token0, to, amount0Out); // optimistically transfer tokens
            if (amount1Out > 0) _safeTransfer(_token1, to, amount1Out); // optimistically transfer tokens

            // calculate balances without locked swaps
            // subtract locked funds that are not part of the reserves
            uint256 balance0 = IERC20(_token0).balanceOf(address(this)) - _totalSwappedFunds0;
            uint256 balance1 = IERC20(_token1).balanceOf(address(this)) - _totalSwappedFunds1;

            // calculate input amounts (input agnostic)
            amount0In = balance0 > reserve0 - amount0Out ? balance0 - (reserve0 - amount0Out) : 0;
            amount1In = balance1 > reserve1 - amount1Out ? balance1 - (reserve1 - amount1Out) : 0;
            if (amount0In <= 0 && amount1In <= 0) revert PAIR_INSUFFICIENT_INPUT_AMOUNT();

            // check K
            if (balance0 * balance1 < uint256(reserve0) * reserve1) revert PAIR_K();

            _updateReserves(balance0, balance1, time);
        }

        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /**
     * @notice Retrieve locked swaps
     * @param _superToken the token to be retrieved
     */
    function retrieveFunds(ISuperToken _superToken) external override lock returns (uint256 returnedBalance) {
        if (address(_superToken) != address(token0) && address(_superToken) != address(token1))
            revert PAIR_TOKEN_NOT_IN_POOL();

        // get realtime reserves
        (uint96 totalFlow0, uint96 totalFlow1, uint32 time) = getRealTimeIncomingFlowRates();
        (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);

        address _token0 = address(token0);
        address _token1 = address(token1);

        uint256 poolBalance0;
        uint256 poolBalance1;

        _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);

        // set user starting cumulative
        if (address(_superToken) == _token1) {
            (, int96 flow0, , ) = cfa.getFlow(token0, msg.sender, address(this));
            returnedBalance = UQ160x96.decode(
                uint256(uint96(flow0)) * (twap1CumulativeLast - userStartingCumulatives1[msg.sender])
            );

            userStartingCumulatives1[msg.sender] = twap1CumulativeLast;
            // NOTICE: mismatched precision between balance calculation and totalSwappedFunds{0,1} (dust amounts)
            _totalSwappedFunds1 -= SafeCast.toUint112(returnedBalance);

            // subtract locked funds that are not part of the reserves
            poolBalance0 = IERC20(_token0).balanceOf(address(this)) - _totalSwappedFunds0;
            poolBalance1 = IERC20(_token1).balanceOf(address(this)) - _totalSwappedFunds1;
            _updateReserves(poolBalance0, poolBalance1, time);

            if (returnedBalance > 0) _safeTransfer(_token1, msg.sender, returnedBalance);
        } else {
            (, int96 flow1, , ) = cfa.getFlow(token1, msg.sender, address(this));
            returnedBalance = UQ160x96.decode(
                uint256(uint96(flow1)) * (twap0CumulativeLast - userStartingCumulatives0[msg.sender])
            );

            userStartingCumulatives0[msg.sender] = twap0CumulativeLast;
            _totalSwappedFunds0 -= SafeCast.toUint112(returnedBalance);

            // subtract locked funds that are not part of the reserves
            poolBalance0 = IERC20(_token0).balanceOf(address(this)) - _totalSwappedFunds0;
            poolBalance1 = IERC20(_token1).balanceOf(address(this)) - _totalSwappedFunds1;
            _updateReserves(poolBalance0, poolBalance1, time);

            if (returnedBalance > 0) _safeTransfer(_token0, msg.sender, returnedBalance);
        }

        emit RetrieveFunds(_superToken, msg.sender, returnedBalance);
    }

    /**
     * @notice Force the reserves to match with the contract's token balances.
     */
    function sync() external override lock {
        (uint96 totalFlow0, uint96 totalFlow1, uint32 time) = getRealTimeIncomingFlowRates();
        (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);
        _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);

        // calculate balances without locked swaps
        // subtract locked funds that are not part of the reserves
        uint256 balance0 = token0.balanceOf(address(this)) - _totalSwappedFunds0;
        uint256 balance1 = token1.balanceOf(address(this)) - _totalSwappedFunds1;

        // update reserves
        _updateReserves(balance0, balance1, time);
    }

    /**
     * @dev Internal function to safely transfer tokens.
     * @param token The address of the token to transfer.
     * @param to The recipient address of the tokens.
     * @param value The amount of tokens to be transferred.
     */
    function _safeTransfer(address token, address to, uint256 value) private {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
        if (!success && (data.length != 0 || !abi.decode(data, (bool)))) revert PAIR_TRANSFER_FAILED();
    }

    /**
     * @dev Internal function to update reserves.
     * @param balance0 The new balance of token0.
     * @param balance1 The new balance of token1.
     * @param time The block timestamp to set as the last updated timestamp.
     */
    function _updateReserves(uint256 balance0, uint256 balance1, uint32 time) private {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert PAIR_OVERFLOW();

        _reserve0 = uint112(balance0);
        _reserve1 = uint112(balance1);
        _blockTimestampLast = time;

        emit Sync(_reserve0, _reserve1);
    }

    /**
     * @dev Internal function to mint fees, if fee is on, mint liquidity equivalent
     *      to 1/6th of the growth in sqrt(k)
     * @param reserve0 The current reserve of token0.
     * @param reserve1 The current reserve of token1.
     * @return feeOn A boolean indicating whether fees are enabled.
     */
    function _mintFee(uint112 reserve0, uint112 reserve1) private returns (bool feeOn) {
        address feeTo = IAqueductV1Factory(factory).feeTo();
        feeOn = feeTo != address(0);
        uint256 _kLast = kLast; // gas savings
        if (feeOn) {
            if (_kLast != 0) {
                uint256 rootK = Math.sqrt(uint256(reserve0) * reserve1);
                uint256 rootKLast = Math.sqrt(_kLast);
                if (rootK > rootKLast) {
                    uint256 numerator = totalSupply * (rootK - rootKLast);
                    uint256 denominator = rootK * 5 + rootKLast;
                    uint256 liquidity = numerator / denominator;
                    if (liquidity > 0) _mint(feeTo, liquidity);
                }
            }
        } else if (_kLast != 0) {
            kLast = 0;
        }
    }

    /**************************************************************************
     * Callback Functions and Superfluid Hooks
     *************************************************************************/

    function _handleCallback(ISuperToken _superToken, bytes calldata _agreementData, bytes calldata _cbdata) internal {
        if (address(_superToken) != address(token0) && address(_superToken) != address(token1))
            revert PAIR_TOKEN_NOT_IN_POOL();

        // decode previous net flowrates
        (uint96 totalFlow0, uint96 totalFlow1, int96 flow0, int96 flow1) = abi.decode(
            _cbdata,
            (uint96, uint96, int96, int96)
        );

        // get time
        uint32 time = uint32(block.timestamp % 2 ** 32);

        // get realtime reserves based on old flowrates
        (uint112 reserve0, uint112 reserve1) = _getReservesAtTime(time, totalFlow0, totalFlow1);

        address _token0 = address(token0);
        address _token1 = address(token1);

        _updateAccumulators(reserve0, reserve1, totalFlow0, totalFlow1, time);

        // set user starting cumulative
        (address user, ) = abi.decode(_agreementData, (address, address));
        if (address(_superToken) == _token0) {
            uint256 balance1 = UQ160x96.decode(
                uint256(uint96(flow0)) * (twap1CumulativeLast - userStartingCumulatives1[user])
            );

            if (balance1 > 0) _safeTransfer(_token1, user, balance1);
            userStartingCumulatives1[user] = twap1CumulativeLast;
            // NOTICE: mismatched precision between balance calculation and totalSwappedFunds{0,1} (dust amounts)
            _totalSwappedFunds1 -= SafeCast.toUint112(balance1);
        } else {
            uint256 balance0 = UQ160x96.decode(
                uint256(uint96(flow1)) * (twap0CumulativeLast - userStartingCumulatives0[user])
            );

            if (balance0 > 0) _safeTransfer(_token0, user, balance0);
            userStartingCumulatives0[user] = twap0CumulativeLast;
            _totalSwappedFunds0 -= SafeCast.toUint112(balance0);
        }

        // subtract locked funds that are not part of the reserves
        uint256 poolBalance0 = IERC20(_token0).balanceOf(address(this)) - _totalSwappedFunds0;
        uint256 poolBalance1 = IERC20(_token1).balanceOf(address(this)) - _totalSwappedFunds1;

        _updateReserves(poolBalance0, poolBalance1, time);
    }

    function _handleBeforeCallback(bytes calldata _agreementData) internal view returns (bytes memory) {
        uint96 totalFlow0 = uint96(cfa.getNetFlow(token0, address(this)));
        uint96 totalFlow1 = uint96(cfa.getNetFlow(token1, address(this)));
        (address user, ) = abi.decode(_agreementData, (address, address));
        (, int96 flow0, , ) = cfa.getFlow(token0, user, address(this));
        (, int96 flow1, , ) = cfa.getFlow(token1, user, address(this));

        return abi.encode(totalFlow0, totalFlow1, flow0, flow1);
    }

    function beforeAgreementCreated(
        ISuperToken, // _superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        return _handleBeforeCallback(agreementData);
    }

    function afterAgreementCreated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, //_agreementId
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    function beforeAgreementUpdated(
        ISuperToken, // _superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        return _handleBeforeCallback(agreementData);
    }

    function afterAgreementUpdated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    function beforeAgreementTerminated(
        ISuperToken, //_superToken,
        address, // agreementClass
        bytes32, // agreementId
        bytes calldata agreementData,
        bytes calldata // _ctx
    ) external view virtual override returns (bytes memory) {
        return _handleBeforeCallback(agreementData);
    }

    function afterAgreementTerminated(
        ISuperToken _superToken,
        address, //_agreementClass,
        bytes32, // _agreementId,
        bytes calldata _agreementData,
        bytes calldata _cbdata,
        bytes calldata _ctx
    ) external override onlyHost returns (bytes memory newCtx) {
        _handleCallback(_superToken, _agreementData, _cbdata);
        newCtx = _ctx;
    }

    /**************************************************************************
     * Modifiers
     *************************************************************************/

    modifier lock() {
        if (unlocked != 1) revert PAIR_LOCKED();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    modifier onlyHost() {
        if (msg.sender != address(cfaV1.host)) revert PAIR_SUPPORT_ONLY_ONE_HOST();
        _;
    }
}
