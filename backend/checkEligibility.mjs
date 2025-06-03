import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import path from 'path';
import dotenv from 'dotenv';
import { getClient } from './database.mjs';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

// Environment variables for configuration
const requiredHoldingMonths = parseInt(process.env.REQUIRED_HOLDING_MONTHS) || 3;
const tokenMintAddress = process.env.TOKEN_MINT_ADDRESS;
const minTokenAmount = parseInt(process.env.MIN_TOKEN_AMOUNT) || 1;
const solanaApiUrl = process.env.SOLANA_API_URL || 'https://api.mainnet-beta.solana.com';

// Setup Solana connection
const connection = new Connection(solanaApiUrl, 'confirmed');

async function hasRequiredTokens(walletAddress) {
    try {
        const publicKey = new PublicKey(walletAddress);
        const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            programId: TOKEN_PROGRAM_ID
        });
        
        const tokenAccounts = accounts.value.filter(account => {
            const tokenData = account.account.data.parsed.info;
            return tokenData.mint === tokenMintAddress && 
                   parseInt(tokenData.tokenAmount.amount) >= minTokenAmount;
        });
        
        return tokenAccounts.length > 0;
    } catch (error) {
        console.error(`Error checking token balance for ${walletAddress.slice(0, 6)}...`);
        return false;
    }
}

export default async function checkEligibility() {
    console.log('Starting eligibility check...');
    const client = await getClient();
    
    try {
        // Get all submissions from PostgreSQL
        const { rows } = await client.query('SELECT * FROM submissions');
        console.log(`Checking eligibility for ${rows.length} wallets`);
        
        // Process each wallet
        for (const row of rows) {
            try {
                const { walletaddress, timestamp } = row;
                const initialDate = new Date(timestamp);
                const now = new Date();
                
                // Calculate exact months between dates
                const monthsHeld = (
                    (now.getFullYear() - initialDate.getFullYear()) * 12 + 
                    (now.getMonth() - initialDate.getMonth())
                );
                
                // Extra check for partial months - if day of month is earlier in the current month, subtract one month
                const adjustedMonthsHeld = (now.getDate() < initialDate.getDate()) ? monthsHeld - 1 : monthsHeld;
                
                // Check if the wallet has the required tokens
                const hasTokens = await hasRequiredTokens(walletaddress);
                
                // A wallet is eligible if it has held tokens for the required period
                const eligible = adjustedMonthsHeld >= requiredHoldingMonths && hasTokens;
                
                // Update eligibility in database
                await client.query(
                    'UPDATE submissions SET iseligible = $1 WHERE walletaddress = $2',
                    [eligible, walletaddress]
                );
                
                console.log(`Wallet ${walletaddress.slice(0, 6)}... eligibility updated: ${eligible}`);
            } catch (walletError) {
                console.error(`Error updating eligibility for wallet: ${row.walletaddress?.slice(0, 6) || 'unknown'}...`, walletError);
                // Continue with next wallet
            }
        }
        
        console.log('Eligibility check completed successfully');
    } catch (error) {
        console.error('Error during eligibility check:', error);
    } finally {
        client.release();
    }
}
