import {AqueductV1Pair} from "../../../src/AqueductV1Pair.sol";
import {ISuperfluid} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

contract AqueductV1PairHarness is AqueductV1Pair {
    constructor(ISuperfluid host) AqueductV1Pair(host) {}

    function exposed_calculateFees(uint112 totalFlow, uint32 timeElapsed) external returns (uint112) {
        return _calculateFees(totalFlow, timeElapsed);
    }
}
