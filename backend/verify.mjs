#!/usr/bin/env node
/**
 * Solana Token Airdrop Platform Verification Script
 * This script performs comprehensive checks on the platform to ensure integrity:
 * 1. Verifies database connection and schema
 * 2. Validates environment variables
 * 3. Tests Solana blockchain connectivity
 * 4. Checks wallet address verification
 * 5. Validates signature verification functionality
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as web3 from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getClient, query } from './database.mjs';
import { Keypair } from '@solana/web3.js';
import { createMessageToSign, verifySignature } from './verifySignature.mjs';

// Setup directory paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

// Log formatting
const success = msg => console.log(`✅ ${msg}`);
const warning = msg => console.log(`⚠️ ${msg}`);
const error = msg => console.error(`❌ ${msg}`);
const info = msg => console.log(`ℹ️ ${msg}`);

// Verify environment variables
async function verifyEnvironment() {
    console.log('\n📋 Verifying environment variables...');
    
    const requiredVars = [
        // Database
        'PG_HOST', 'PG_PORT', 'PG_DATABASE', 'PG_USER', 'PG_PASSWORD',
        // Solana
        'SOLANA_API_URL', 'TOKEN_MINT_ADDRESS', 'MIN_TOKEN_AMOUNT', 'REQUIRED_HOLDING_MONTHS'
    ];
    
    const recommendedVars = [
        'HOT_WALLET_SECRET', 'API_VERSION', 'FRONTEND_URL', 
        'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS', 'SIGNATURE_EXPIRY_MINUTES'
    ];
    
    let missingRequired = false;
    
    // Check required vars
    for (const varName of requiredVars) {
        if (!process.env[varName]) {
            error(`Missing required environment variable: ${varName}`);
            missingRequired = true;
        } else {
            success(`Found required environment variable: ${varName}`);
        }
    }
    
    // Check recommended vars
    for (const varName of recommendedVars) {
        if (!process.env[varName]) {
            warning(`Missing recommended environment variable: ${varName}`);
        } else {
            success(`Found recommended environment variable: ${varName}`);
        }
    }
    
    // Verify hot wallet if provided
    if (process.env.HOT_WALLET_SECRET) {
        try {
            const hotWalletKey = bs58.decode(process.env.HOT_WALLET_SECRET);
            const keypair = Keypair.fromSecretKey(hotWalletKey);
            success(`Hot wallet keypair loaded successfully: ${keypair.publicKey.toString().substring(0, 4)}...${keypair.publicKey.toString().substring(keypair.publicKey.toString().length - 4)}`);
        } catch (err) {
            error(`Invalid hot wallet secret key: ${err.message}`);
        }
    }
    
    // Validate token mint address
    if (process.env.TOKEN_MINT_ADDRESS) {
        try {
            new web3.PublicKey(process.env.TOKEN_MINT_ADDRESS);
            success(`Token mint address is valid: ${process.env.TOKEN_MINT_ADDRESS.substring(0, 4)}...${process.env.TOKEN_MINT_ADDRESS.substring(process.env.TOKEN_MINT_ADDRESS.length - 4)}`);
        } catch (err) {
            error(`Invalid token mint address: ${err.message}`);
        }
    }
    
    return !missingRequired;
}

// Verify database connection
async function verifyDatabase() {
    console.log('\n🗄️ Verifying database connection and schema...');
    
    let client;
    try {
        client = await getClient();
        success('Successfully connected to PostgreSQL database');
        
        // Check if submissions table exists
        const { rows: tables } = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'submissions'
        `);
        
        if (tables.length === 0) {
            error('Submissions table does not exist in the database');
            return false;
        }
        
        success('Submissions table exists in the database');
        
        // Check table structure
        const { rows: columns } = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'submissions'
        `);
        
        const requiredColumns = [
            'walletaddress', 'walletname', 'publichash', 'iseligible', 
            'isvalidonchain', 'timestamp', 'hasclaimed', 'signatureverified'
        ];
        
        const columnNames = columns.map(col => col.column_name);
        
        const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));
        
        if (missingColumns.length > 0) {
            error(`Missing required columns: ${missingColumns.join(', ')}`);
            return false;
        }
        
        success('All required columns exist in the submissions table');
        
        // Check for existing records
        const { rows: records } = await client.query('SELECT COUNT(*) FROM submissions');
        info(`Database contains ${records[0].count} submission records`);
        
        return true;
    } catch (err) {
        error(`Database verification failed: ${err.message}`);
        return false;
    } finally {
        if (client) client.release();
    }
}

// Verify Solana connection
async function verifySolanaConnection() {
    console.log('\n🔗 Verifying Solana blockchain connection...');
    
    try {
        const connection = new web3.Connection(
            process.env.SOLANA_API_URL || 'https://api.mainnet-beta.solana.com',
            'confirmed'
        );
        
        const version = await connection.getVersion();
        success(`Connected to Solana ${version['solana-core']}`);
        
        const slot = await connection.getSlot();
        success(`Current slot: ${slot}`);
        
        // Verify token mint account existence
        if (process.env.TOKEN_MINT_ADDRESS) {
            try {
                const mintPubkey = new web3.PublicKey(process.env.TOKEN_MINT_ADDRESS);
                const mintInfo = await connection.getAccountInfo(mintPubkey);
                
                if (mintInfo) {
                    success(`Token mint account exists on-chain`);
                } else {
                    error(`Token mint account not found on-chain`);
                }
            } catch (err) {
                error(`Error checking token mint account: ${err.message}`);
            }
        }
        
        return true;
    } catch (err) {
        error(`Solana connection failed: ${err.message}`);
        return false;
    }
}

// Verify signature verification functionality
async function verifySignatureVerification() {
    console.log('\n🔐 Verifying signature verification functionality...');
    
    try {
        // Generate a test keypair
        const testKeypair = web3.Keypair.generate();
        const walletAddress = testKeypair.publicKey.toString();
        
        // Create a message to sign
        const { message, timestamp } = createMessageToSign(walletAddress);
        success(`Created test message: "${message}" with timestamp ${timestamp}`);
        
        // Sign the message
        const messageUint8 = new TextEncoder().encode(message);
        const signature = nacl.sign.detached(messageUint8, testKeypair.secretKey);
        const signatureBase58 = bs58.encode(signature);
        success(`Generated signature: ${signatureBase58.substring(0, 10)}...`);
        
        // Verify the signature
        const isValid = verifySignature(walletAddress, message, signatureBase58);
        
        if (isValid) {
            success('Signature verification works correctly');
        } else {
            error('Signature verification failed');
        }
        
        return isValid;
    } catch (err) {
        error(`Signature verification test failed: ${err.message}`);
        return false;
    }
}

// Main verification function
async function runVerification() {
    console.log('🔍 Starting Solana Token Airdrop Platform verification...');
    
    let allPassed = true;
    
    // Run all verification checks
    const envOk = await verifyEnvironment();
    const dbOk = await verifyDatabase();
    const solanaOk = await verifySolanaConnection();
    const signatureOk = await verifySignatureVerification();
    
    allPassed = envOk && dbOk && solanaOk && signatureOk;
    
    // Output summary
    console.log('\n📊 Verification Summary:');
    console.log(`Environment Variables: ${envOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Database Connection: ${dbOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Solana Connection: ${solanaOk ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Signature Verification: ${signatureOk ? '✅ PASS' : '❌ FAIL'}`);
    
    if (allPassed) {
        console.log('\n🎉 All verification checks passed! The system is ready for use.');
    } else {
        console.log('\n⚠️ Some verification checks failed. Please fix the issues before proceeding.');
    }
    
    return allPassed;
}

// Run the verification
runVerification().catch(err => {
    console.error('Verification process error:', err);
    process.exit(1);
});
