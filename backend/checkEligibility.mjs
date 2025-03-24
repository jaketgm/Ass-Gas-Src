import { open } from "sqlite";
import sqlite3 from "sqlite3";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

const requiredHoldingMonths = 3;
const dbPath = path.join(process.cwd(), 'data', 'submissions.db');
const connection = new Connection("https://api.mainnet-beta.solana.com", 'confirmed');

async function hasTokensBeenSold(walletAddress) {
    try {
        const publicKey = new PublicKey(walletAddress);
        const balance = await connection.getTokenAccountBalance(publicKey);
        return balance.value.uiAmount > 0;
    } catch (error) {
        console.error(`Error checking balance for ${walletAddress}:`, error);
        return false;
    }
}

export default async function checkEligibility() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    const rows = await db.all(`SELECT * FROM submissions`);

    for (const row of rows) {
        const { walletAddress, timestamp } = row;
        const initialDate = new Date(timestamp);
        const now = new Date();
        const diffInMonths = (now - initialDate) / (1000 * 60 * 60 * 24 * 30);
        const hasNotSold = await hasTokensBeenSold(walletAddress);

        const eligible = diffInMonths >= requiredHoldingMonths && hasNotSold ? 1 : 0;

        await db.run(
            `UPDATE submissions SET isEligible = ? WHERE walletAddress = ?`,
            [eligible, walletAddress]
        );
    }

    console.log('Eligibility check complete.');
}
