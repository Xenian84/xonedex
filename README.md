# XoneDEX - Decentralized Exchange on X1 Blockchain

A complete Uniswap V2-style AMM (Automated Market Maker) implementation for the X1 blockchain, featuring native XNT support and Token 2022 compatibility.

## 🏗️ Architecture

- **Smart Contracts**: Rust + Anchor (Solana-compatible)
- **Frontend**: React + TypeScript + Vite
- **Blockchain**: X1 (Solana fork with full SVM compatibility)

## 📁 Repository Structure

```
XONEDEX/
├── smart-contracts/    # Rust/Anchor smart contracts
│   └── programs/
│       └── ammv2/      # Main AMM program
└── frontend-v2/        # React/TypeScript web interface
```

## 🚀 Quick Start

### Prerequisites

- Rust 1.70+
- Solana CLI 2.1.0+
- Anchor 0.31.1+
- Node.js 18+
- npm or yarn

### Smart Contracts

```bash
cd smart-contracts
anchor build
anchor deploy
```

### Frontend

```bash
cd frontend-v2
npm install
npm run dev
```

## 🌐 Networks

- **Testnet**: `https://rpc.testnet.x1.xyz`
- **Mainnet**: `https://rpc.mainnet.x1.xyz`

## 🔑 Program IDs

- **Testnet**: `2Sya8FEfD1J6wbR6imW6YFjQgaamLQY1ZSghRPKWSxPu`
- **Mainnet**: `AMMEDavgL7M5tbrxoXmtmxM7iArJb98KkoBW1EtFFJ2`

## ✨ Features

- ✅ Uniswap V2-style AMM
- ✅ Native XNT pools (no wrapping required)
- ✅ Token 2022 support
- ✅ Standard SPL Token support
- ✅ Protocol fee collection
- ✅ Liquidity provider rewards
- ✅ Swap functionality
- ✅ Add/Remove liquidity

## 📝 License

MIT

## 🔗 Links

- **Website**: https://xonedex.xyz
- **Explorer**: https://explorer.testnet.x1.xyz
- **Documentation**: Coming soon
