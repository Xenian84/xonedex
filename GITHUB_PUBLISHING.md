# GitHub Publishing Guide

## ✅ Pre-Publishing Checklist

- [x] Security fixes applied (treasury address configurable)
- [x] `.gitignore` updated (excludes scripts, keypairs, configs)
- [x] `README.md` created
- [x] Git repository initialized

## 📋 Step-by-Step Publishing Instructions

### Step 1: Verify Files to Commit

```bash
cd /root/XONEDEX
git status
```

**Expected output:**
- ✅ `smart-contracts/programs/` (Rust source code)
- ✅ `smart-contracts/Cargo.toml`
- ✅ `smart-contracts/Anchor.toml` (sanitized)
- ✅ `frontend-v2/src/` (React/TypeScript source)
- ✅ `frontend-v2/public/` (public assets)
- ✅ `frontend-v2/package.json` and config files
- ✅ `.gitignore`
- ✅ `README.md`

**Should NOT see:**
- ❌ `smart-contracts/scripts/`
- ❌ `smart-contracts/config/`
- ❌ `smart-contracts/xuniswap-keypairs/`
- ❌ `smart-contracts/tests/`
- ❌ Any `.json` keypair files

### Step 2: Verify No Sensitive Files

```bash
# Check for keypair files
git status | grep -i keypair

# Check for scripts
git status | grep scripts

# Check for config folder
git status | grep "smart-contracts/config"

# Should all return empty (no matches)
```

### Step 3: Create Initial Commit

```bash
cd /root/XONEDEX
git add .
git commit -m "Initial commit: XoneDEX AMM smart contracts and frontend

- Smart contracts: Rust/Anchor AMM implementation
- Frontend: React/TypeScript DEX interface
- Features: Native XNT pools, Token 2022 support
- Security: Configurable treasury address, no hardcoded secrets"
```

### Step 4: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `xonedex` (or your preferred name)
3. Description: "Decentralized Exchange on X1 Blockchain - Uniswap V2-style AMM"
4. Visibility: **Public** (or Private if preferred)
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click "Create repository"

### Step 5: Connect and Push

```bash
cd /root/XONEDEX

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/xonedex.git

# Or if using SSH:
# git remote add origin git@github.com:YOUR_USERNAME/xonedex.git

# Rename branch to main (GitHub standard)
git branch -M main

# Push to GitHub
git push -u origin main
```

### Step 6: Verify on GitHub

1. Go to your repository: `https://github.com/YOUR_USERNAME/xonedex`
2. Verify:
   - ✅ README.md displays correctly
   - ✅ No `scripts/` folder visible
   - ✅ No `xuniswap-keypairs/` folder visible
   - ✅ No `config/` folder in smart-contracts
   - ✅ Source code is present

## 🔒 Security Verification

After publishing, verify no sensitive data leaked:

```bash
# Check repository for any hardcoded secrets
curl -s https://raw.githubusercontent.com/YOUR_USERNAME/xonedex/main/frontend-v2/src/utils/nativeLiquidity.ts | grep -i "2sgQ7LzA7urZ4joMy4uU3Rcus82ZoLbHa54UvChJc9j3"
# Should show the fallback address (public, OK)

# Check for API keys
curl -s https://raw.githubusercontent.com/YOUR_USERNAME/xonedex/main/frontend-v2/src/utils/nativeLiquidity.ts | grep -i "api.*key\|pinata\|secret"
# Should return empty

# Verify scripts folder doesn't exist
curl -s https://api.github.com/repos/YOUR_USERNAME/xonedex/contents/smart-contracts/scripts
# Should return 404 (not found)
```

## 📝 Post-Publishing

### Optional: Add Topics/Tags

On GitHub repository page:
- Click "Add topics"
- Add: `x1-blockchain`, `dex`, `amm`, `uniswap-v2`, `solana`, `defi`, `rust`, `react`, `typescript`

### Optional: Add License

If you want to add a license:

```bash
cd /root/XONEDEX
# Create LICENSE file (MIT example)
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2025 XoneDEX

Permission is hereby granted...
EOF

git add LICENSE
git commit -m "Add MIT license"
git push
```

### Optional: Add GitHub Actions (CI/CD)

Create `.github/workflows/build.yml`:

```yaml
name: Build

on: [push, pull_request]

jobs:
  build-smart-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions-rs/toolchain@v1
        with:
          toolchain: stable
      - run: cd smart-contracts && anchor build

  build-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: cd frontend-v2 && npm ci && npm run build
```

## 🎉 Done!

Your repository is now published and secure!

## 📞 Support

If you encounter any issues:
1. Check `.gitignore` is working correctly
2. Verify no sensitive files were committed
3. Review GitHub repository settings

