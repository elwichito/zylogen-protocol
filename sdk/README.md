# Zylogen SDK

JavaScript SDK for [Zylogen Protocol](https://zylogen.xyz) — AI-validated escrow on Base L2.

## Install

```bash
npm install zylogen-sdk ethers
```

## Quick Start

```javascript
const { ethers } = require("ethers");
const { ZylogenSDK } = require("zylogen-sdk");

// Connect to Base Mainnet
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const signer   = new ethers.Wallet("YOUR_PRIVATE_KEY", provider);
const zylogen  = new ZylogenSDK(signer);

// Create a $10 USDC task
const task = await zylogen.createTaskUSDC(
  "0xProviderAddress",
  10.00,
  "Write a market analysis report"
);
console.log("Task created:", task.taskHash);

// Create an ETH task
const ethTask = await zylogen.createTaskETH(
  "0xProviderAddress",
  "0.005",
  "Translate document to Spanish"
);

// Check task status
const info = await zylogen.getTask(task.taskHash);
console.log(info);
// { sender, provider, amount: 10, token: "USDC", deadline, isExpired }

// Listen for new tasks (for agents/bots)
zylogen.onTaskCreated((event) => {
  console.log("New task:", event.taskHash, event.amount, event.token);
});
```

## API

| Method | Description |
|---|---|
| `createTaskUSDC(provider, amount, description)` | Lock USDC in escrow |
| `createTaskETH(provider, amountETH, description)` | Lock ETH in escrow |
| `createTaskToken(provider, tokenAddr, amount, desc)` | Lock any ERC-20 |
| `getTask(taskHash)` | Get escrow details |
| `isActive(taskHash)` | Check if task exists |
| `release(taskHash)` | Release funds (oracle only) |
| `reclaim(taskHash)` | Reclaim after timeout (sender only) |
| `onTaskCreated(callback)` | Listen for new tasks |
| `onTaskReleased(callback)` | Listen for releases |
| `getUSDCBalance(address)` | Check USDC balance |
| `getProtocolInfo()` | Get oracle, treasury, fees |

## Contracts

| Contract | Address | Network |
|---|---|---|
| TaskEscrowV2 | `0xC10D9b263612733C1752eFDe9CD617887216832c` | Base Mainnet |
| TaskEscrowV1 | `0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f` | Base Mainnet |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base Mainnet |

## Links

- Website: [zylogen.xyz](https://zylogen.xyz)
- GitHub: [elwichito/zylogen-protocol](https://github.com/elwichito/zylogen-protocol)
- Basescan: [View V2 Contract](https://basescan.org/address/0xC10D9b263612733C1752eFDe9CD617887216832c)

## License

MIT
