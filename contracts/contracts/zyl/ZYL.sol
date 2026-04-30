// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  ZYL — Zylogen Protocol Settlement Token
/// @notice Fixed supply ERC-20. No mint, no pause, no admin minting authority.
///         Burn is restricted to whitelisted contracts burning their OWN balance.
///         `burnFrom` reverts unconditionally to neutralize allowance-chain attacks
///         (Vector 1.1).
/// @dev    Built on OZ ERC20 + ERC20Permit. ERC20Burnable is intentionally NOT
///         inherited because it exposes `burnFrom`.
contract ZYL is ERC20, ERC20Permit, Ownable {
    /// @notice 1,000,000,000 ZYL (18 decimals). Minted once in constructor.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    /// @notice Contracts permitted to burn their own ZYL balance via `burn()`.
    mapping(address => bool) public burnWhitelist;

    event BurnWhitelistUpdated(address indexed contractAddr, bool allowed);
    event Burned(address indexed burner, uint256 amount);

    error NotWhitelisted();
    error BurnFromDisabled();
    error ZeroAddress();

    /// @param initialOwner    Owner of the contract — MUST be a multisig
    ///                        (or a trusted factory that transfers to multisig
    ///                        atomically in the same tx).
    /// @param supplyRecipient Receives the entire 1B initial supply.
    ///                        For atomic factory deploy this is the factory.
    constructor(address initialOwner, address supplyRecipient)
        ERC20("Zylogen", "ZYL")
        ERC20Permit("Zylogen")
        Ownable(initialOwner)
    {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (supplyRecipient == address(0)) revert ZeroAddress();
        _mint(supplyRecipient, TOTAL_SUPPLY);
    }

    // ─── Burn surface ─────────────────────────────────────────────────────────

    /// @notice Whitelisted contracts burn their own balance. Cannot burn third
    ///         parties (Vector 1.1).
    /// @dev    `_burn(msg.sender, amount)` — never an arbitrary account.
    function burn(uint256 amount) external {
        if (!burnWhitelist[msg.sender]) revert NotWhitelisted();
        _burn(msg.sender, amount);
        emit Burned(msg.sender, amount);
    }

    /// @notice Permanently disabled. Reverts under all circumstances.
    /// @dev    Defensive override: if any consumer expects ERC20Burnable's
    ///         `burnFrom`, they'll fail loud rather than silently using a
    ///         missing function. Vector 1.1.
    function burnFrom(address, uint256) external pure {
        revert BurnFromDisabled();
    }

    // ─── Whitelist administration ─────────────────────────────────────────────

    /// @notice Owner (multisig + timelock) toggles burn permission for a
    ///         contract. Per spec, the timelock cadence is enforced by the
    ///         multisig wallet itself (e.g. SafeTimelockController), not in
    ///         this contract.
    function setBurnWhitelist(address contractAddr, bool allowed) external onlyOwner {
        if (contractAddr == address(0)) revert ZeroAddress();
        burnWhitelist[contractAddr] = allowed;
        emit BurnWhitelistUpdated(contractAddr, allowed);
    }
}
