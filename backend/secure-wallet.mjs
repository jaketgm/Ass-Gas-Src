/**
 * Secure Wallet Management for Production Environments
 * 
 * This module provides secure wallet operations using AWS KMS or local encryption
 * for managing hot wallet keys in production environments.
 * 
 * Features:
 * - AWS KMS integration for secure key storage and signing
 * - Local encrypted storage with password protection as fallback
 * - Transaction signing without exposing private keys
 * - Key rotation capabilities
 */

import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { promisify } from 'util';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

// Constants
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_ITERATION_COUNT = 100000;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Check if AWS SDK is available
let AWS;
try {
  AWS = await import('aws-sdk');
} catch (error) {
  console.log('AWS SDK not available. Using local encryption fallback.');
}

/**
 * Encrypts a wallet's secret key using a password
 * @param {string} secretKey - Base58 encoded secret key
 * @param {string} password - Password for encryption
 * @returns {string} - Encrypted data in hex format
 */
export function encryptWalletKey(secretKey, password) {
  // Generate random salt
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  // Derive key from password
  const key = crypto.pbkdf2Sync(
    password, 
    salt, 
    KEY_ITERATION_COUNT, 
    KEY_LENGTH, 
    'sha512'
  );
  
  // Generate random IV
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // Create cipher
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  // Encrypt the secret key
  const encrypted = Buffer.concat([
    cipher.update(secretKey, 'utf8'),
    cipher.final()
  ]);
  
  // Get authentication tag
  const authTag = cipher.getAuthTag();
  
  // Combine all components: salt + iv + authTag + encrypted
  const result = Buffer.concat([salt, iv, authTag, encrypted]);
  
  // Return as hex string
  return result.toString('hex');
}

/**
 * Decrypts a wallet's secret key
 * @param {string} encryptedData - Hex encoded encrypted data
 * @param {string} password - Password for decryption
 * @returns {string} - Decrypted secret key
 */
export function decryptWalletKey(encryptedData, password) {
  // Convert hex to buffer
  const data = Buffer.from(encryptedData, 'hex');
  
  // Extract components
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = data.slice(
    SALT_LENGTH + IV_LENGTH, 
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const encrypted = data.slice(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  // Derive key from password
  const key = crypto.pbkdf2Sync(
    password, 
    salt, 
    KEY_ITERATION_COUNT, 
    KEY_LENGTH, 
    'sha512'
  );
  
  // Create decipher
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });
  
  // Set auth tag
  decipher.setAuthTag(authTag);
  
  // Decrypt
  try {
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error('Decryption failed. Invalid password or corrupted data.');
  }
}

/**
 * Wallet class that handles secure key operations
 */
export class SecureWallet {
  constructor(options = {}) {
    this.publicKey = null;
    this.useKms = options.useKms || false;
    this.kmsKeyId = options.kmsKeyId || process.env.KMS_KEY_ID;
    this.region = options.region || process.env.AWS_REGION || 'us-east-1';
    
    // Initialize KMS if available and configured
    if (this.useKms && AWS) {
      this.kms = new AWS.KMS({ region: this.region });
    }
  }
  
  /**
   * Load wallet from environment variable
   * @returns {Promise<void>}
   */
  async loadFromEnv() {
    if (!process.env.HOT_WALLET_SECRET) {
      throw new Error('HOT_WALLET_SECRET not found in environment variables');
    }
    
    const secretKey = bs58.decode(process.env.HOT_WALLET_SECRET);
    const keypair = Keypair.fromSecretKey(secretKey);
    this.publicKey = keypair.publicKey;
    
    console.log(`Loaded wallet: ${this.publicKey.toString()}`);
  }
  
  /**
   * Load wallet from KMS
   * @param {string} kmsKeyId - KMS key ID
   * @returns {Promise<void>}
   */
  async loadFromKms(kmsKeyId) {
    if (!this.kms) {
      throw new Error('AWS KMS not available');
    }
    
    this.kmsKeyId = kmsKeyId || this.kmsKeyId;
    
    if (!this.kmsKeyId) {
      throw new Error('KMS Key ID not provided');
    }
    
    // For KMS, we just need the public key as KMS handles the private key
    if (!process.env.HOT_WALLET_PUBLIC_KEY) {
      throw new Error('HOT_WALLET_PUBLIC_KEY not found in environment variables');
    }
    
    this.publicKey = new PublicKey(process.env.HOT_WALLET_PUBLIC_KEY);
    this.useKms = true;
    
    console.log(`Loaded KMS-protected wallet: ${this.publicKey.toString()}`);
  }
  
  /**
   * Load wallet from encrypted file
   * @param {string} filePath - Path to encrypted wallet file
   * @param {string} password - Password to decrypt the file
   * @returns {Promise<void>}
   */
  async loadFromEncryptedFile(filePath, password) {
    const fileContent = await promisify(fs.readFile)(filePath, 'utf8');
    const decrypted = decryptWalletKey(fileContent, password);
    
    const secretKey = bs58.decode(decrypted);
    const keypair = Keypair.fromSecretKey(secretKey);
    this.publicKey = keypair.publicKey;
    
    // Store encrypted data for signing
    this._encryptedKey = fileContent;
    this._password = password;
    
    console.log(`Loaded encrypted wallet: ${this.publicKey.toString()}`);
  }
  
  /**
   * Sign a transaction
   * @param {Transaction} transaction - Transaction to sign
   * @returns {Promise<Transaction>} - Signed transaction
   */
  async signTransaction(transaction) {
    if (!this.publicKey) {
      throw new Error('Wallet not loaded');
    }
    
    if (this.useKms && this.kms) {
      // Sign the transaction using KMS
      const messageBuffer = transaction.serializeMessage();
      const digestBuffer = crypto.createHash('sha256').update(messageBuffer).digest();
      
      const params = {
        KeyId: this.kmsKeyId,
        Message: digestBuffer,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256'
      };
      
      const { Signature } = await this.kms.sign(params).promise();
      
      // Add the signature to the transaction
      transaction.addSignature(this.publicKey, Buffer.from(Signature));
      return transaction;
    } else if (this._encryptedKey && this._password) {
      // Sign using the locally encrypted key
      const decrypted = decryptWalletKey(this._encryptedKey, this._password);
      const secretKey = bs58.decode(decrypted);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      transaction.sign(keypair);
      return transaction;
    } else {
      // Sign using the environment variable key
      const secretKey = bs58.decode(process.env.HOT_WALLET_SECRET);
      const keypair = Keypair.fromSecretKey(secretKey);
      
      transaction.sign(keypair);
      return transaction;
    }
  }
  
  /**
   * Create a new wallet and save encrypted version to file
   * @param {string} outputPath - Path to save the encrypted wallet
   * @param {string} password - Password for encryption
   * @returns {Object} - Wallet information
   */
  static async createEncryptedWallet(outputPath, password) {
    // Generate new keypair
    const keypair = Keypair.generate();
    const publicKey = keypair.publicKey.toString();
    const secretKeyBase58 = bs58.encode(keypair.secretKey);
    
    // Encrypt the secret key
    const encrypted = encryptWalletKey(secretKeyBase58, password);
    
    // Save to file
    await promisify(fs.writeFile)(
      outputPath, 
      encrypted, 
      { encoding: 'utf8', mode: 0o600 }
    );
    
    // Return wallet info (excluding secret key)
    return {
      publicKey,
      filePath: outputPath
    };
  }
  
  /**
   * Rotate a wallet key and re-encrypt with new password
   * @param {string} inputPath - Path to existing encrypted wallet
   * @param {string} oldPassword - Old password
   * @param {string} newPassword - New password
   * @param {string} outputPath - Path to save the new encrypted wallet
   * @returns {Object} - Updated wallet information
   */
  static async rotateWalletKey(inputPath, oldPassword, newPassword, outputPath) {
    // Read and decrypt the existing wallet
    const fileContent = await promisify(fs.readFile)(inputPath, 'utf8');
    const decrypted = decryptWalletKey(fileContent, oldPassword);
    
    // Re-encrypt with new password
    const encrypted = encryptWalletKey(decrypted, newPassword);
    
    // Save to new file
    await promisify(fs.writeFile)(
      outputPath || inputPath, 
      encrypted, 
      { encoding: 'utf8', mode: 0o600 }
    );
    
    // Get public key
    const secretKey = bs58.decode(decrypted);
    const keypair = Keypair.fromSecretKey(secretKey);
    const publicKey = keypair.publicKey.toString();
    
    // Return wallet info
    return {
      publicKey,
      filePath: outputPath || inputPath
    };
  }
}

// Example usage for wallet creation with password protection
export async function createSecureWallet(outputPath, password) {
  try {
    const walletInfo = await SecureWallet.createEncryptedWallet(outputPath, password);
    console.log(`Created new encrypted wallet at ${outputPath}`);
    console.log(`Public Key: ${walletInfo.publicKey}`);
    return walletInfo;
  } catch (error) {
    console.error('Error creating secure wallet:', error);
    throw error;
  }
}

// Example usage for KMS-based wallet signing
export async function signWithKms(transaction, publicKeyString) {
  try {
    const wallet = new SecureWallet({ useKms: true });
    await wallet.loadFromKms();
    
    if (publicKeyString && wallet.publicKey.toString() !== publicKeyString) {
      throw new Error('Public key mismatch');
    }
    
    return await wallet.signTransaction(transaction);
  } catch (error) {
    console.error('Error signing with KMS:', error);
    throw error;
  }
}
