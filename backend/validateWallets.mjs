import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

const connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

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
