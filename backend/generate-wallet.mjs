#!/usr/bin/env node
/**
 * Solana Wallet Generator
 * 
 * This script generates Solana wallets for use with the airdrop platform.
 * It can create a new random wallet or recover a wallet from an existing secret key.
 * 
 * Usage:
 *   node generate-wallet.mjs [--recover <base58-secret-key>] [--output <file-path>]
 * 
 * Options:
 *   --recover: Base58 encoded secret key to recover a wallet
 *   --output: Path to save the wallet info (WARNING: includes private key, secure this file!)
 * 
 * Security warning:
 *   - This script outputs sensitive key material that must be protected
 *   - For production hot wallets, consider using a hardware wallet or HSM
 *   - Never share your secret key or save it in unsecured locations
 */

import { Keypair } from '@solana/web3.js';
import * as web3 from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Parse command line arguments
const args = process.argv.slice(2);
let recoverKey = null;
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--recover' && i + 1 < args.length) {
    recoverKey = args[i + 1];
    i++;
  } else if (args[i] === '--output' && i + 1 < args.length) {
    outputPath = args[i + 1];
    i++;
  }
}

// Generate or recover keypair
let keypair;
if (recoverKey) {
  try {
    const secretKey = bs58.decode(recoverKey);
    keypair = Keypair.fromSecretKey(secretKey);
    console.log('🔑 Successfully recovered wallet from secret key');
  } catch (error) {
    console.error('❌ Error recovering wallet:', error.message);
    process.exit(1);
  }
} else {
  keypair = Keypair.generate();
  console.log('🔑 Generated new random wallet');
}

// Get wallet information
const publicKey = keypair.publicKey.toString();
const secretKeyBase58 = bs58.encode(keypair.secretKey);

// Display wallet information
console.log('\n📋 Wallet Information:');
console.log('===========================================');
console.log(`📬 Public Address: ${publicKey}`);
console.log(`🔐 Secret Key (Base58): ${secretKeyBase58}`);
console.log('===========================================');

// Calculate a hash of the public key for use as a public hash identifier
const publicHash = crypto.createHash('sha256').update(publicKey).digest('hex').substring(0, 32);
console.log(`🏷️ Public Hash (for DB reference): ${publicHash}`);

// Save to file if output path provided
if (outputPath) {
  const walletInfo = {
    publicKey,
    secretKeyBase58,
    publicHash,
    createdAt: new Date().toISOString()
  };
  
  // Create directory if it doesn't exist
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(
    outputPath, 
    JSON.stringify(walletInfo, null, 2),
    { encoding: 'utf8', mode: 0o600 } // Restrict file permissions to owner only
  );
  
  console.log(`\n💾 Wallet information saved to: ${outputPath}`);
  console.log('⚠️ WARNING: This file contains your private key. Keep it secure!');
}

// Generate environment variable configuration example
console.log('\n⚙️ For .env configuration:');
console.log('===========================================');
console.log(`HOT_WALLET_SECRET=${secretKeyBase58}`);
console.log('===========================================');

// Check wallet balance if possible
try {
  const connection = new web3.Connection(
    process.env.SOLANA_API_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
  
  console.log('\n🔍 Checking wallet on-chain...');
  connection.getBalance(keypair.publicKey)
    .then(balance => {
      console.log(`💰 Wallet balance: ${balance / web3.LAMPORTS_PER_SOL} SOL`);
    })
    .catch(err => {
      console.error('❌ Failed to check balance:', err.message);
    });
} catch (error) {
  console.log('⚠️ Could not connect to Solana network to check balance');
}

// Print signature verification example
console.log('\n📝 To verify ownership of this wallet:');
console.log('===========================================');
console.log('1. Create a message: `Sign this message to verify wallet ownership: <timestamp>`');
console.log('2. Sign it with your wallet');
console.log('3. Verify the signature against your public key');
console.log('===========================================');

// Security recommendations
console.log('\n🛡️ Security Recommendations:');
console.log('===========================================');
console.log('1. Store your secret key in a password manager or hardware wallet');
console.log('2. Consider using a hardware wallet for production deployments');
console.log('3. For hot wallets, use a dedicated machine with limited access');
console.log('4. Regularly rotate hot wallet keys used for automated operations');
console.log('5. Use multi-signature wallets for high-value operations');
console.log('===========================================');
