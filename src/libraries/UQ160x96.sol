// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.19;

// a library for handling binary fixed point numbers (https://en.wikipedia.org/wiki/Q_(number_format))

// range: ???
// resolution: ???

library UQ160x96 {
    //solhint-disable-next-line state-visibility
    uint224 constant Q96 = 2 ** 96;

    // encode a uint160 as a UQ160x96
    function encode(uint160 y) internal pure returns (uint256 z) {
        z = uint256(y) * Q96; // never overflows
    }

    // decode a UQ160x96 to a uint160
    function decode(uint256 z) internal pure returns (uint256 y) {
        y = z / Q96;
    }

    // divide a UQ160x96 by a uint96, returning a UQ160x96
    function uqdiv(uint256 x, uint96 y) internal pure returns (uint256 z) {
        z = x / uint256(y);
    }
}
