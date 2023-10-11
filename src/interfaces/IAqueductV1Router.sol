// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.12;

import {IAqueductV1Router01} from "./IAqueductV1Router01.sol";

interface IAqueductV1Router is IAqueductV1Router01 {
    error ROUTER_EXPIRED();
    error ROUTER_INSUFFICIENT_A_AMOUNT();
    error ROUTER_INSUFFICIENT_B_AMOUNT();
    error ROUTER_INSUFFICIENT_OUTPUT_AMOUNT();
    error ROUTER_EXCESSIVE_INPUT_AMOUNT();
    error ROUTER_INVALID_PATH();
    error STREAM_END_DATE_BEFORE_NOW();
    error ROUTER_STREAM_FEE_TOO_LOW();
    error PAIR_SUPPORT_ONLY_ONE_HOST();
}
