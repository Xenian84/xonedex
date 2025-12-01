# Token Selection Components

## Overview

XoneDEX uses a consistent token selection system across all pages. This document explains the proper way to manage token selection.

## Components

### 1. `TokenSelectModal`
**Location**: `components/TokenSelect/TokenSelectModal.tsx`

The core modal component that displays the token list with:
- Search functionality
- Token verification badges
- Balance display
- Wallet token discovery
- Sorting (verified tokens first, then by balance)

**Usage**: This is the underlying modal - typically not used directly.

---

### 2. `TokenSelectorButton`
**Location**: `components/TokenSelect/TokenSelectorButton.tsx`

**Purpose**: Reusable button component for token selection when you only need to select a token (no amount input).

**When to use**:
- Liquidity page (token pair selection)
- Settings pages
- Any place where you just need to select a token

**Props**:
```typescript
interface TokenSelectorButtonProps {
  mint: string;                    // Current selected token mint address
  onSelect: (token: TokenInfo) => void;  // Callback when token is selected
  excludeToken?: string;           // Token to exclude from list (e.g., other side of pair)
  label?: string;                  // Optional label above button
  className?: string;             // Optional custom styling
  showLabel?: boolean;             // Show label above button
}
```

**Example**:
```tsx
<TokenSelectorButton
  mint={mint0}
  onSelect={(token) => setMint0(token.address)}
  excludeToken={mint1}
  label="Token 0"
  showLabel={true}
/>
```

---

### 3. `TokenInput`
**Location**: `components/Swap/TokenInput.tsx`

**Purpose**: Integrated component for token selection WITH amount input. Used in Swap interface.

**When to use**:
- Swap page (needs amount input + token selection)
- Any place where you need both token selection and amount input together

**Props**:
```typescript
interface TokenInputProps {
  label: string;
  mint: string;
  amount: string;
  onAmountChange: (amount: string) => void;
  onMintChange?: (mint: string) => void;
  excludeToken?: string;
  wrappedXNTBalance?: number;
  readonly?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}
```

**Example**:
```tsx
<TokenInput
  label="From"
  mint={inputMint}
  amount={inputAmount}
  onAmountChange={setInputAmount}
  onMintChange={setInputMint}
  excludeToken={outputMint}
/>
```

---

## Architecture Decision

### Why Two Components?

1. **TokenSelectorButton**: Simple token selection
   - Used in: Liquidity page (Step 1 - token pair selection)
   - Provides: Just token selection button
   - Benefits: Lightweight, consistent UI

2. **TokenInput**: Integrated token + amount input
   - Used in: Swap page
   - Provides: Token selection + amount input + balance display + MAX/HALF buttons
   - Benefits: Complete swap input interface

### Both Use Same Modal

Both components use `TokenSelectModal` internally, ensuring:
- ✅ Consistent token list display
- ✅ Same verification badges
- ✅ Same search functionality
- ✅ Same sorting logic
- ✅ Same performance optimizations

---

## Best Practices

### ✅ DO:

1. **Use TokenSelectorButton** for simple token selection:
   ```tsx
   // Liquidity page - selecting token pair
   <TokenSelectorButton
     mint={mint0}
     onSelect={handleTokenSelect0}
     excludeToken={mint1}
   />
   ```

2. **Use TokenInput** when you need amount input:
   ```tsx
   // Swap page - selecting token and entering amount
   <TokenInput
     label="From"
     mint={inputMint}
     amount={inputAmount}
     onAmountChange={setInputAmount}
     onMintChange={setInputMint}
   />
   ```

3. **Always exclude the other token** in pairs:
   ```tsx
   excludeToken={mint1}  // Prevents selecting same token twice
   ```

### ❌ DON'T:

1. **Don't create custom token selectors** - use the provided components
2. **Don't use TokenSelectModal directly** - use TokenSelectorButton or TokenInput
3. **Don't duplicate token selection logic** - reuse the components

---

## Current Usage

### Swap Page
- Uses: `TokenInput` component
- Reason: Needs amount input integrated with token selection
- Location: `components/Swap/SwapPanel.tsx`

### Liquidity Page
- Uses: `TokenSelectorButton` component
- Reason: Only needs token selection (amounts come later)
- Location: `pages/Liquidity.tsx`

---

## Consistency Benefits

By using these shared components:
- ✅ **Consistent UI**: Same look and feel everywhere
- ✅ **Consistent UX**: Same interaction patterns
- ✅ **Maintainability**: One place to update token selection logic
- ✅ **Performance**: Shared optimizations (caching, batch fetching)
- ✅ **Features**: All pages get new features automatically (verification badges, etc.)

---

## Future Enhancements

When adding new features to token selection:
1. Update `TokenSelectModal` (core functionality)
2. Both `TokenSelectorButton` and `TokenInput` automatically get the feature
3. No need to update individual pages

---

## Summary

**Proper way to manage token selection:**

1. **For simple selection**: Use `TokenSelectorButton`
2. **For selection + amount**: Use `TokenInput`
3. **Both use**: Same `TokenSelectModal` internally
4. **Result**: Consistent, maintainable, performant token selection across the app

