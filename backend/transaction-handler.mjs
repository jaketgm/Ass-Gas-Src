/**
 * Transaction Handler for Solana Token Airdrops
 * 
 * This module handles secure token transfers for the airdrop platform:
 * - Creates and signs transactions for SPL token transfers
 * - Implements retry logic for failed transactions
 * - Provides transaction monitoring and verification
 * - Supports both regular and batch transfers for efficiency
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import bs58 from 'bs58';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecureWallet } from './secure-wallet.mjs';
import { query, getClient } from './database.mjs';

// Configure environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Initialize connection
const connection = new Connection(
  process.env.SOLANA_API_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Load token mint
const tokenMint = new PublicKey(process.env.TOKEN_MINT_ADDRESS);
const airdropAmount = parseInt(process.env.AIRDROP_AMOUNT || '1000');

// Maximum retries for failed transactions
const MAX_RETRIES = 3;
// Delay between retries in milliseconds
const RETRY_DELAY = 2000;

/**
 * Initialize the hot wallet
 * @returns {Promise<SecureWallet>} - Initialized wallet
 */
async function initializeHotWallet() {
  const wallet = new SecureWallet();
  
  try {
    // Try to use AWS KMS if configured
    if (process.env.KMS_KEY_ID && process.env.HOT_WALLET_PUBLIC_KEY) {
      await wallet.loadFromKms();
    } else {
      // Fall back to environment variable
      await wallet.loadFromEnv();
    }
    
    return wallet;
  } catch (error) {
    console.error('Failed to initialize hot wallet:', error);
    throw new Error('Hot wallet initialization failed. Check your configuration.');
  }
}

/**
 * Create and execute a token transfer transaction
 * @param {string} recipientAddress - Recipient wallet address
 * @param {number} amount - Amount of tokens to transfer (in token units)
 * @returns {Promise<Object>} - Transaction result
 */
export async function transferTokens(recipientAddress, amount = airdropAmount) {
  let retries = 0;
  let lastError = null;
  
  // Initialize wallet
  const hotWallet = await initializeHotWallet();
  
  // Get database client for transaction
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    
    // Lock the recipient record to prevent double claiming
    const { rows } = await client.query(
      'SELECT walletaddress FROM submissions WHERE walletaddress = $1 AND iseligible = true AND hasclaimed = false FOR UPDATE',
      [recipientAddress]
    );
    
    if (rows.length === 0) {
      throw new Error('Recipient not eligible or has already claimed');
    }
    
    // Validate the recipient wallet
    const recipientPublicKey = new PublicKey(recipientAddress);
    
    // Check if recipient account exists
    const recipientAccount = await connection.getAccountInfo(recipientPublicKey);
    if (!recipientAccount) {
      throw new Error('Recipient account does not exist on-chain');
    }
    
    // Execute the transfer with retries
    while (retries <= MAX_RETRIES) {
      try {
        // Get the associated token account for the hot wallet
        const sourceTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          hotWallet,
          tokenMint,
          hotWallet.publicKey
        );
        
        // Get or create the associated token account for the recipient
        const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          hotWallet,
          tokenMint,
          recipientPublicKey
        );
        
        // Create a transfer instruction
        const transferInstruction = createTransferInstruction(
          sourceTokenAccount.address,
          destinationTokenAccount.address,
          hotWallet.publicKey,
          amount * (10 ** 9), // Adjust for token decimals
          [],
          TOKEN_PROGRAM_ID
        );
        
        // Create a transaction
        const transaction = new Transaction().add(transferInstruction);
        
        // Set recent blockhash and sign transaction
        transaction.recentBlockhash = (await connection.getRecentBlockhash()).blockhash;
        transaction.feePayer = hotWallet.publicKey;
        
        // Sign the transaction
        const signedTransaction = await hotWallet.signTransaction(transaction);
        
        // Send and confirm the transaction
        const signature = await sendAndConfirmTransaction(
          connection,
          signedTransaction,
          [hotWallet]
        );
        
        // Update database to mark as claimed
        await client.query(
          'UPDATE submissions SET hasclaimed = true, claimtimestamp = NOW(), transactionhash = $1 WHERE walletaddress = $2',
          [signature, recipientAddress]
        );
        
        // Commit the database transaction
        await client.query('COMMIT');
        
        // Return the successful result
        return {
          success: true,
          signature,
          recipient: recipientAddress,
          amount,
          timestamp: new Date()
        };
      } catch (error) {
        lastError = error;
        retries++;
        
        if (retries <= MAX_RETRIES) {
          console.warn(`Transfer attempt ${retries} failed, retrying in ${RETRY_DELAY}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    }
    
    // If we get here, all retries failed
    await client.query('ROLLBACK');
    throw new Error(`Transfer failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Token transfer error:', error);
    
    return {
      success: false,
      error: error.message,
      recipient: recipientAddress,
      timestamp: new Date()
    };
  } finally {
    client.release();
  }
}

/**
 * Process batch transfers for multiple recipients
 * @param {Array<string>} recipients - Array of recipient wallet addresses
 * @param {number} amount - Amount of tokens to transfer to each recipient
 * @returns {Promise<Array<Object>>} - Array of transaction results
 */
export async function batchTransferTokens(recipients, amount = airdropAmount) {
  const results = [];
  
  for (const recipient of recipients) {
    try {
      const result = await transferTokens(recipient, amount);
      results.push(result);
      
      // Add a small delay between transactions to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
        recipient,
        timestamp: new Date()
      });
    }
  }
  
  return results;
}

/**
 * Verify a transaction was successful
 * @param {string} signature - Transaction signature
 * @returns {Promise<boolean>} - Whether the transaction was successful
 */
export async function verifyTransaction(signature) {
  try {
    const status = await connection.getSignatureStatus(signature);
    
    if (!status || !status.value) {
      return false;
    }
    
    return status.value.confirmationStatus === 'confirmed' || 
           status.value.confirmationStatus === 'finalized';
  } catch (error) {
    console.error('Error verifying transaction:', error);
    return false;
  }
}

/**
 * Get the token balance for a wallet
 * @param {string} walletAddress - Wallet address to check
 * @returns {Promise<number>} - Token balance
 */
export async function getTokenBalance(walletAddress) {
  try {
    const walletPublicKey = new PublicKey(walletAddress);
    
    // Find the associated token account
    const tokenAccount = await connection.getTokenAccountsByOwner(
      walletPublicKey,
      { mint: tokenMint }
    );
    
    if (tokenAccount.value.length === 0) {
      return 0;
    }
    
    // Get the balance
    const accountInfo = await connection.getParsedAccountInfo(
      tokenAccount.value[0].pubkey
    );
    
    if (!accountInfo.value) {
      return 0;
    }
    
    const balance = accountInfo.value.data.parsed.info.tokenAmount.uiAmount;
    return balance;
  } catch (error) {
    console.error('Error getting token balance:', error);
    return 0;
  }
}

/**
 * Check if a wallet has sufficient SOL for transaction fees
 * @param {string} walletAddress - Wallet address to check
 * @returns {Promise<boolean>} - Whether the wallet has sufficient SOL
 */
export async function hasSufficientSol(walletAddress) {
  try {
    const walletPublicKey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(walletPublicKey);
    
    // Require at least 0.001 SOL for fees
    return balance >= 0.001 * LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error checking SOL balance:', error);
    return false;
  }
}

/**
 * Monitor hot wallet balance and alert if low
 * @param {number} threshold - Threshold in token units
 * @returns {Promise<boolean>} - Whether the balance is above the threshold
 */
export async function monitorHotWalletBalance(threshold = 10000) {
  try {
    const hotWallet = await initializeHotWallet();
    const balance = await getTokenBalance(hotWallet.publicKey.toString());
    
    const isLow = balance < threshold;
    
    if (isLow) {
      console.warn(`⚠️ HOT WALLET BALANCE LOW: ${balance} tokens remaining!`);
      // Here you would implement your alerting mechanism
      // e.g., send an email, Slack notification, etc.
    }
    
    return !isLow;
  } catch (error) {
    console.error('Error monitoring hot wallet balance:', error);
    return false;
  }
}
