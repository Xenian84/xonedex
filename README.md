# XoneDEX - Decentralized Exchange on X1 Blockchain

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![X1 Blockchain](https://img.shields.io/badge/Blockchain-X1-blue)](https://x1.xyz)
[![TypeScript](https://img.shields.io/badge/TypeScript-79.8%25-blue)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-17.9%25-orange)](https://www.rust-lang.org/)

A complete Uniswap V2-style AMM (Automated Market Maker) implementation for the X1 blockchain, featuring native XNT support and Token 2022 compatibility.

## 🌟 Features

- ✅ **Uniswap V2-style AMM** - Battle-tested AMM design
- ✅ **Native XNT Pools** - Trade native XNT without wrapping
- ✅ **Token 2022 Support** - Full compatibility with Solana's Token 2022 standard
- ✅ **Standard SPL Token Support** - Works with all SPL tokens
- ✅ **Protocol Fee Collection** - Configurable treasury fees
- ✅ **Liquidity Provider Rewards** - Earn fees by providing liquidity
- ✅ **Swap Functionality** - Seamless token swaps
- ✅ **Add/Remove Liquidity** - Easy liquidity management

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

## 📖 Documentation

- [GitHub Publishing Guide](./GITHUB_PUBLISHING.md) - How to publish and contribute
- [X1 Blockchain Docs](https://docs.x1.xyz) - X1 blockchain documentation

## 🔗 Links

- **Website**: https://xonedex.xyz
- **Explorer**: https://explorer.mainnet.x1.xyz
- **Testnet Explorer**: https://explorer.testnet.x1.xyz

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.


## 🙏 Acknowledgments

- **Forked from**: [anchor-uniswap-v2](https://github.com/0xNineteen/anchor-uniswap-v2) by [0xNineteen](https://github.com/0xNineteen)
- Built on [X1 Blockchain](https://x1.xyz)
- Inspired by [Uniswap V2](https://uniswap.org/)
- Uses [Anchor Framework](https://www.anchor-lang.com/)

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

**Note**: This project is a fork of [anchor-uniswap-v2](https://github.com/0xNineteen/anchor-uniswap-v2) and maintains the same MIT license.

---

**Made with ❤️ for the X1 ecosystem**
