// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";

/// @title  IACPHook — ERC-8183 §3.8 hook interface (verbatim from spec)
/// @notice Optional contract that the kernel calls around each hookable
///         lifecycle function. Hooks receive the selector + ABI-encoded args
///         per §3.8 and MAY revert to block / roll back the action.
interface IACPHook {
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external;
}

/// @title  ZylogenJob — ERC-8183 Agentic Commerce kernel
/// @author Zylogen Protocol
/// @notice Pure ERC-8183 implementation. Zero Zylogen-specific economics —
///         no fees, no burn, no rewards, no reputation. Those features live
///         in optional `IACPHook` contracts that a founder may plug in at
///         `createJob`. See ZYLOGENJOB_DESIGN.md for the architectural split.
/// @dev    Immutable kernel: no `Ownable`, no upgradeability. The only admin
///         affordance is a `PAUSER` role (set in constructor, never settable)
///         that can pause `createJob` and `fund` if a vulnerability is found.
///         Existing jobs continue to settle/expire normally even while paused.
///         Spec reference: https://eips.ethereum.org/EIPS/eip-8183
contract ZylogenJob is ReentrancyGuard, Pausable, ERC2771Context {
    using SafeERC20 for IERC20;

    // ─── Types (ERC-8183 §3.3) ────────────────────────────────────────────────

    enum JobStatus { Open, Funded, Submitted, Completed, Rejected, Expired }

    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string  description;
        uint256 budget;
        uint64  expiredAt;
        JobStatus status;
        address hook;
    }

    // ─── Constants ────────────────────────────────────────────────────────────

    /// @notice Maximum lifetime for any job, measured from `createJob` block.
    ///         A founder needing longer escrow deploys a fresh kernel.
    uint64 public constant MAX_DURATION = 365 days;

    /// @notice Hard gas budget for each hook call (beforeAction or afterAction).
    ///         Per ERC-8183 §8: implementations SHOULD impose a gas limit.
    uint256 public constant HOOK_GAS_LIMIT = 500_000;

    // ─── Immutable state ──────────────────────────────────────────────────────

    /// @notice The single ERC-20 token this kernel escrows. Per ERC-8183 §3.3,
    ///         per-contract single token is the default; per-job tokens are an
    ///         OPTIONAL extension this kernel does not implement.
    IERC20 public immutable PAYMENT_TOKEN;

    /// @notice Address authorized to call `pause()` / `unpause()`. Set once at
    ///         construction. Cannot do anything else — no fund movement, no
    ///         status override, no parameter change.
    address public immutable PAUSER;

    // ─── State ────────────────────────────────────────────────────────────────

    uint256 private _nextJobId;
    mapping(uint256 => Job) private _jobs;

    // ─── Events (ERC-8183 §3.9 verbatim) ──────────────────────────────────────

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address evaluator,
        uint64  expiredAt,
        address hook
    );
    event ProviderSet(uint256 indexed jobId, address indexed provider);
    event BudgetSet(uint256 indexed jobId, uint256 amount);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable);
    event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason);
    event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason);
    event JobExpired(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────────

    error InvalidStatus(uint256 jobId, JobStatus expected, JobStatus actual);
    error Unauthorized(address caller);
    error ZeroAddress();
    error EvaluatorMustBeSetAtCreation();
    error ExpiredAtNotInFuture(uint64 expiredAt);
    error ExpiredAtTooFar(uint64 expiredAt, uint64 maxAllowed);
    error ProviderNotSet();
    error ProviderAlreadySet();
    error BudgetMismatch(uint256 expected, uint256 actual);
    error BudgetIsZero();
    error NotExpired(uint64 expiredAt, uint64 nowTs);
    error HookCallFailed(address hook, bytes4 selector);
    error NotPauser();

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param paymentToken_      ERC-20 token used for every job's escrow.
    ///                           MUST NOT be address(0).
    /// @param pauser_            Address allowed to pause/unpause. MUST NOT be
    ///                           address(0). Cannot be changed afterwards.
    /// @param trustedForwarder_  ERC-2771 trusted forwarder. MAY be address(0)
    ///                           if meta-transactions are not needed; in that
    ///                           case `_msgSender()` always equals `msg.sender`.
    constructor(address paymentToken_, address pauser_, address trustedForwarder_)
        ERC2771Context(trustedForwarder_)
    {
        if (paymentToken_ == address(0) || pauser_ == address(0)) revert ZeroAddress();
        PAYMENT_TOKEN = IERC20(paymentToken_);
        PAUSER = pauser_;
    }

    // ─── Pause / unpause ──────────────────────────────────────────────────────

    modifier onlyPauser() {
        if (_msgSender() != PAUSER) revert NotPauser();
        _;
    }

    /// @notice Halts `createJob` and `fund`. In-flight jobs continue to
    ///         settle, reject, and expire normally.
    function pause() external onlyPauser {
        _pause();
    }

    /// @notice Resumes `createJob` and `fund`.
    function unpause() external onlyPauser {
        _unpause();
    }

    // ─── Lifecycle: createJob ─────────────────────────────────────────────────

    /// @notice Create a new job in `Open` state. The caller (`_msgSender()`)
    ///         is recorded as the client.
    /// @param provider     MAY be address(0); if so, client MUST call
    ///                     `setProvider` before `fund`.
    /// @param evaluator    MUST NOT be address(0). MAY equal the client.
    /// @param expiredAt    Unix timestamp after which `claimRefund` can be
    ///                     invoked. MUST be strictly in the future and within
    ///                     `MAX_DURATION` of `block.timestamp`.
    /// @param description  Human-readable scope reference, stored on-chain.
    /// @param hook         Optional `IACPHook` contract; pass address(0) for
    ///                     a hookless job.
    /// @return jobId       Sequentially assigned identifier (1-indexed).
    function createJob(
        address provider,
        address evaluator,
        uint64  expiredAt,
        string calldata description,
        address hook
    ) external whenNotPaused returns (uint256 jobId) {
        if (evaluator == address(0)) revert EvaluatorMustBeSetAtCreation();
        if (expiredAt <= block.timestamp) revert ExpiredAtNotInFuture(expiredAt);
        uint64 maxAllowed = uint64(block.timestamp) + MAX_DURATION;
        if (expiredAt > maxAllowed) revert ExpiredAtTooFar(expiredAt, maxAllowed);

        jobId = ++_nextJobId;
        _jobs[jobId] = Job({
            id:          jobId,
            client:      _msgSender(),
            provider:    provider,
            evaluator:   evaluator,
            description: description,
            budget:      0,
            expiredAt:   expiredAt,
            status:      JobStatus.Open,
            hook:        hook
        });

        emit JobCreated(jobId, _msgSender(), provider, evaluator, expiredAt, hook);
    }

    // ─── Lifecycle: setProvider ───────────────────────────────────────────────

    /// @notice Assign a provider to an Open job that was created with
    ///         `provider == address(0)`. Client only.
    /// @dev    Hookable. Encoding per ERC-8183 §3.8:
    ///         `data = abi.encode(provider, optParams)`.
    function setProvider(uint256 jobId, address provider, bytes calldata optParams) external {
        Job storage job = _jobs[jobId];
        _assertStatus(jobId, job.status, JobStatus.Open);
        if (job.client != _msgSender()) revert Unauthorized(_msgSender());
        if (job.provider != address(0)) revert ProviderAlreadySet();
        if (provider == address(0)) revert ZeroAddress();

        bytes memory hookData = abi.encode(provider, optParams);
        _callHook(job, IACPHook.beforeAction.selector, this.setProvider.selector, hookData);

        job.provider = provider;
        emit ProviderSet(jobId, provider);

        _callHook(job, IACPHook.afterAction.selector, this.setProvider.selector, hookData);
    }

    // ─── Lifecycle: setBudget ─────────────────────────────────────────────────

    /// @notice Set the job budget. Client or provider, while Open. Setting it
    ///         again before funding is allowed (price negotiation).
    /// @dev    Hookable. Encoding: `data = abi.encode(amount, optParams)`.
    function setBudget(uint256 jobId, uint256 amount, bytes calldata optParams) external {
        Job storage job = _jobs[jobId];
        _assertStatus(jobId, job.status, JobStatus.Open);
        address caller = _msgSender();
        if (caller != job.client && caller != job.provider) revert Unauthorized(caller);

        bytes memory hookData = abi.encode(amount, optParams);
        _callHook(job, IACPHook.beforeAction.selector, this.setBudget.selector, hookData);

        job.budget = amount;
        emit BudgetSet(jobId, amount);

        _callHook(job, IACPHook.afterAction.selector, this.setBudget.selector, hookData);
    }

    // ─── Lifecycle: fund ──────────────────────────────────────────────────────

    /// @notice Escrow `expectedBudget` of `PAYMENT_TOKEN` from the client. The
    ///         `expectedBudget` parameter is a front-running guard: the call
    ///         reverts if the on-chain `budget` was changed between when the
    ///         client signed and when the tx confirmed.
    /// @dev    Hookable. Encoding per ERC-8183 §3.8: `data = optParams` (raw).
    function fund(uint256 jobId, uint256 expectedBudget, bytes calldata optParams)
        external
        whenNotPaused
        nonReentrant
    {
        Job storage job = _jobs[jobId];
        _assertStatus(jobId, job.status, JobStatus.Open);
        if (job.client != _msgSender()) revert Unauthorized(_msgSender());
        if (job.provider == address(0)) revert ProviderNotSet();
        if (job.budget == 0) revert BudgetIsZero();
        if (job.budget != expectedBudget) revert BudgetMismatch(expectedBudget, job.budget);

        bytes memory hookData = optParams;
        _callHook(job, IACPHook.beforeAction.selector, this.fund.selector, hookData);

        job.status = JobStatus.Funded;
        PAYMENT_TOKEN.safeTransferFrom(job.client, address(this), job.budget);

        emit JobFunded(jobId, job.client, job.budget);

        _callHook(job, IACPHook.afterAction.selector, this.fund.selector, hookData);
    }

    // ─── Lifecycle: submit ────────────────────────────────────────────────────

    /// @notice Provider signals that the deliverable is ready for evaluation,
    ///         moving the job from Funded to Submitted.
    /// @dev    Hookable. Encoding: `data = abi.encode(deliverable, optParams)`.
    /// @param  deliverable  Reference to off-chain work (hash, CID, attestation
    ///                      commitment). Opaque to the kernel.
    function submit(uint256 jobId, bytes32 deliverable, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        _assertStatus(jobId, job.status, JobStatus.Funded);
        if (job.provider != _msgSender()) revert Unauthorized(_msgSender());

        bytes memory hookData = abi.encode(deliverable, optParams);
        _callHook(job, IACPHook.beforeAction.selector, this.submit.selector, hookData);

        job.status = JobStatus.Submitted;
        emit JobSubmitted(jobId, job.provider, deliverable);

        _callHook(job, IACPHook.afterAction.selector, this.submit.selector, hookData);
    }

    // ─── Lifecycle: complete ──────────────────────────────────────────────────

    /// @notice Evaluator approves the submitted deliverable; the kernel
    ///         releases the full budget to the provider.
    /// @dev    Hookable. Encoding: `data = abi.encode(reason, optParams)`.
    ///         The reason is opaque to the kernel — typically a hash of the
    ///         off-chain attestation evidence. `bytes32(0)` denotes "no reason".
    function complete(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        _assertStatus(jobId, job.status, JobStatus.Submitted);
        if (job.evaluator != _msgSender()) revert Unauthorized(_msgSender());

        bytes memory hookData = abi.encode(reason, optParams);
        _callHook(job, IACPHook.beforeAction.selector, this.complete.selector, hookData);

        job.status = JobStatus.Completed;
        uint256 amount = job.budget;
        address provider = job.provider;

        PAYMENT_TOKEN.safeTransfer(provider, amount);

        emit JobCompleted(jobId, _msgSender(), reason);
        emit PaymentReleased(jobId, provider, amount);

        _callHook(job, IACPHook.afterAction.selector, this.complete.selector, hookData);
    }

    // ─── Lifecycle: reject ────────────────────────────────────────────────────

    /// @notice Reject the job. Allowed transitions:
    ///         - Open      → Rejected: client only (no escrow movement)
    ///         - Funded    → Rejected: evaluator only (refunds client)
    ///         - Submitted → Rejected: evaluator only (refunds client)
    /// @dev    Hookable. Encoding: `data = abi.encode(reason, optParams)`.
    function reject(uint256 jobId, bytes32 reason, bytes calldata optParams) external nonReentrant {
        Job storage job = _jobs[jobId];
        JobStatus current = job.status;
        address caller = _msgSender();

        if (current == JobStatus.Open) {
            if (job.client != caller) revert Unauthorized(caller);
        } else if (current == JobStatus.Funded || current == JobStatus.Submitted) {
            if (job.evaluator != caller) revert Unauthorized(caller);
        } else {
            // Cannot reject from Completed / Rejected / Expired.
            revert InvalidStatus(jobId, JobStatus.Funded, current);
        }

        bytes memory hookData = abi.encode(reason, optParams);
        _callHook(job, IACPHook.beforeAction.selector, this.reject.selector, hookData);

        job.status = JobStatus.Rejected;
        emit JobRejected(jobId, caller, reason);

        // Refund escrow only if it was previously funded.
        if (current != JobStatus.Open) {
            uint256 amount = job.budget;
            address client = job.client;
            PAYMENT_TOKEN.safeTransfer(client, amount);
            emit Refunded(jobId, client, amount);
        }

        _callHook(job, IACPHook.afterAction.selector, this.reject.selector, hookData);
    }

    // ─── Lifecycle: claimRefund (NOT hookable) ────────────────────────────────

    /// @notice Permissionless. After `expiredAt`, anyone may call this and the
    ///         full escrow is refunded to the client. Fixes the M13 violation
    ///         in the legacy contract where timeout paid the worker.
    /// @dev    Per ERC-8183 §3.8, this function is hardcoded NOT hookable so a
    ///         malicious hook cannot block the client's safety net.
    function claimRefund(uint256 jobId) external nonReentrant {
        Job storage job = _jobs[jobId];
        JobStatus current = job.status;

        if (current != JobStatus.Funded && current != JobStatus.Submitted) {
            revert InvalidStatus(jobId, JobStatus.Funded, current);
        }
        if (block.timestamp < job.expiredAt) {
            revert NotExpired(job.expiredAt, uint64(block.timestamp));
        }

        job.status = JobStatus.Expired;
        uint256 amount = job.budget;
        address client = job.client;

        PAYMENT_TOKEN.safeTransfer(client, amount);

        emit JobExpired(jobId);
        emit Refunded(jobId, client, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /// @notice Returns the full job record. Reverts implicitly on bad jobId
    ///         only if the consumer differentiates — the default Solidity
    ///         behavior returns a zero-initialized struct for unknown ids.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice Address of the ERC-20 token this kernel uses for every escrow.
    function paymentToken() external view returns (address) {
        return address(PAYMENT_TOKEN);
    }

    /// @notice Highest jobId issued so far. The next `createJob` returns
    ///         `nextJobId() + 1`. Useful for off-chain indexers.
    function nextJobId() external view returns (uint256) {
        return _nextJobId;
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    function _assertStatus(uint256 jobId, JobStatus actual, JobStatus expected) internal pure {
        if (actual != expected) revert InvalidStatus(jobId, expected, actual);
    }

    /// @dev Invokes the job's hook with a strict gas budget and propagates any
    ///      revert reason from the hook. No-op if `job.hook == address(0)`.
    ///      `claimRefund` deliberately never calls this — it's the
    ///      non-blockable safety mechanism per ERC-8183 §3.8.
    function _callHook(Job storage job, bytes4 hookSelector, bytes4 actionSelector, bytes memory data) internal {
        address hook = job.hook;
        if (hook == address(0)) return;

        (bool ok, bytes memory ret) = hook.call{gas: HOOK_GAS_LIMIT}(
            abi.encodeWithSelector(hookSelector, job.id, actionSelector, data)
        );
        if (!ok) {
            if (ret.length > 0) {
                // Bubble up the hook's revert reason for debuggability.
                assembly {
                    let returndata_size := mload(ret)
                    revert(add(ret, 0x20), returndata_size)
                }
            }
            revert HookCallFailed(hook, actionSelector);
        }
    }

    // ─── ERC-2771 overrides ───────────────────────────────────────────────────

    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
