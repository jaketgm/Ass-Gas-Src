import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

// Use environment variable for API endpoint
const solanaApiUrl = process.env.SOLANA_API_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(solanaApiUrl, 'confirmed');

export default async function validateWallets(publicHash) {
    try {
        const publicKey = new PublicKey(publicHash);

        // Fetch account info
        const accountInfo = await connection.getAccountInfo(publicKey);
        if (!accountInfo) {
            console.error(`❌ Wallet ${publicHash} does NOT exist on-chain.`);
            return false;
        }

        // Fetch SOL balance
        const balance = await connection.getBalance(publicKey);
        if (balance === 0) {
            console.error(`⚠️ Wallet ${publicHash} exists but has ZERO SOL.`);
            return false;
        }

        // Additional Validation: Ensure it's not a program address (a valid user wallet)
        if (accountInfo.executable) {
            console.error(`❌ Wallet ${publicHash} is a PROGRAM, not a user wallet.`);
            return false;
        }

        console.log(`✅ Wallet ${publicHash} is valid with balance: ${balance / 1e9} SOL`);
        return true;

    } catch (err) {
        console.error(`❌ Wallet validation error for ${publicHash}:`, err);
        return false;
    }
}
