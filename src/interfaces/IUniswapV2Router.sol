// SPDX-License-Identifier: GPL-3.0-or-later

pragma solidity =0.8.12;

import "./IUniswapV2Router01.sol";

interface IUniswapV2Router is IUniswapV2Router01 {

    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external;
}
