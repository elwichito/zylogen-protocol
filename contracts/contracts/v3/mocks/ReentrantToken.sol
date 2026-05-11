// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentrancyTarget {
    function claimRefund(uint256 jobId) external;
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external;
}

/// @notice ERC-20 that attempts to re-enter the caller during transfer.
///         Used to verify ZylogenJob's `nonReentrant` guard.
contract ReentrantToken is ERC20 {
    address public target;
    uint256 public targetJobId;
    bytes4 public reentryFn; // selector to call: claimRefund or complete

    bool public armed;
    bool public attempted;
    bool public lastAttemptReverted;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function arm(address target_, uint256 jobId_, bytes4 fn_) external {
        target = target_;
        targetJobId = jobId_;
        reentryFn = fn_;
        armed = true;
        attempted = false;
        lastAttemptReverted = false;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && to != address(0) && from != address(0)) {
            armed = false;
            attempted = true;
            (bool ok, ) = target.call(abi.encodeWithSelector(reentryFn, targetJobId));
            lastAttemptReverted = !ok;
        }
    }
}
