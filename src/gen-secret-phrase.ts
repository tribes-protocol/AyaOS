import { english, generateMnemonic, mnemonicToAccount } from 'viem/accounts'
import { z } from 'zod'

/**
 * Generate a 12-word mnemonic phrase and derive a wallet address from it
 */
function generateSecretPhraseAndAddress(): { mnemonic: string; address: string } {
  // Generate a new random mnemonic phrase
  const mnemonic = generateMnemonic(english, 128)

  // Create an account from the mnemonic
  const account = mnemonicToAccount(mnemonic)

  return {
    mnemonic,
    address: account.address
  }
}

// Define schema for the result
const WalletInfoSchema = z.object({
  mnemonic: z.string(),
  address: z.string()
})

// Main execution
const walletInfo = generateSecretPhraseAndAddress()

// Validate the result with zod
const validatedInfo = WalletInfoSchema.parse(walletInfo)

// Display the result
console.log('Secret phrase (mnemonic):', validatedInfo.mnemonic)
console.log('Wallet address:', validatedInfo.address)
