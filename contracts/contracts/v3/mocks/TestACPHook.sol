// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IACPHook} from "../ZylogenJob.sol";

/// @notice Configurable hook used by ZylogenJob tests. Records every call,
///         and can be set to revert in beforeAction, in afterAction, or to
///         consume a configurable amount of gas to exercise HOOK_GAS_LIMIT.
contract TestACPHook is IACPHook {
    enum Mode { Pass, RevertBefore, RevertAfter, ConsumeGas, RevertBeforeNoMsg }

    Mode public mode;
    uint256 public gasToBurn;

    struct Call {
        uint256 jobId;
        bytes4  selector;
        bytes   data;
        bool    isBefore;
    }

    Call[] public calls;

    function setMode(Mode m) external { mode = m; }
    function setGasToBurn(uint256 g) external { gasToBurn = g; }
    function callCount() external view returns (uint256) { return calls.length; }

    function getCall(uint256 i) external view returns (uint256, bytes4, bytes memory, bool) {
        Call memory c = calls[i];
        return (c.jobId, c.selector, c.data, c.isBefore);
    }

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        calls.push(Call({ jobId: jobId, selector: selector, data: data, isBefore: true }));
        if (mode == Mode.RevertBefore) revert("hook: blocked before");
        if (mode == Mode.RevertBeforeNoMsg) {
            assembly { revert(0, 0) }
        }
        if (mode == Mode.ConsumeGas) _burnGas();
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        calls.push(Call({ jobId: jobId, selector: selector, data: data, isBefore: false }));
        if (mode == Mode.RevertAfter) revert("hook: blocked after");
        if (mode == Mode.ConsumeGas) _burnGas();
    }

    function _burnGas() internal view {
        uint256 target = gasleft() > gasToBurn ? gasleft() - gasToBurn : 0;
        while (gasleft() > target) {
            // pure waste
            assembly { pop(gas()) }
        }
    }
}
