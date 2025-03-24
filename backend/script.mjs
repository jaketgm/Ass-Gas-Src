import express from 'express';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';

import validateWallets from './validateWallets.mjs';
import checkEligibility from './checkEligibility.mjs';

// ✅ Forcefully load .env from the correct directory
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// ✅ Load and validate HOT_WALLET_SECRET
const HOT_WALLET_SECRET = process.env.HOT_WALLET_SECRET;
let HOT_WALLET;

if (!HOT_WALLET_SECRET) {
    console.error("❌ Error: HOT_WALLET_SECRET is missing in .env!");
    process.exit(1);
}

try {
    HOT_WALLET = Keypair.fromSecretKey(bs58.decode(HOT_WALLET_SECRET));
} catch (error) {
    console.error("❌ Error: HOT_WALLET_SECRET is not a valid Base58 string!");
    process.exit(1);
}

// ✅ Set up database
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPromise = open({
    filename: path.join(dataDir, 'submissions.db'),
    driver: sqlite3.Database
});

// ✅ CoinGecko API Proxy with Rate-Limiting & Caching
const cache = {};
const CACHE_TTL_MS = 60_000; // Cache expiration time (60 seconds)

const cgLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Too many requests, please slow down.' },
});

app.use(express.json()); // ✅ Parses incoming JSON requests
app.use(express.urlencoded({ extended: true })); // ✅ Handles form submissions

app.use('/api/coingecko', cgLimiter, async (req, res) => {
    try {
        const cacheKey = req.originalUrl;
        const now = Date.now();

        if (cache[cacheKey] && now - cache[cacheKey].timestamp < CACHE_TTL_MS) {
            res.set('Access-Control-Allow-Origin', '*');
            return res.json(cache[cacheKey].data);
        }

        const cgUrl = 'https://api.coingecko.com' + req.originalUrl.replace('/api/coingecko', '');
        const cgResponse = await fetch(cgUrl, { method: req.method, headers: { 'Content-Type': 'application/json' } });

        if (!cgResponse.ok) {
            return res.status(cgResponse.status).json({ error: `CoinGecko error: ${cgResponse.status} ${cgResponse.statusText}` });
        }

        const data = await cgResponse.json();
        cache[cacheKey] = { data, timestamp: now };

        res.set('Access-Control-Allow-Origin', '*');
        res.json(data);

    } catch (err) {
        console.error('CoinGecko Proxy Error:', err);
        res.status(500).json({ error: 'Internal proxy error' });
    }
});

// ✅ Airdrop Claiming
app.post('/api/collectAirdrop', async (req, res) => {
    try {
        const { publicHash } = req.body;
        const db = await dbPromise;
        const user = await db.get(`SELECT * FROM submissions WHERE publicHash = ?`, [publicHash]);

        if (!user) return res.status(404).json({ error: "No submission found for this publicHash" });
        if (user.hasClaimed) return res.status(400).json({ error: "Airdrop already claimed." });

        const eligible = user.isEligible === 1;
        if (!eligible) return res.status(400).json({ error: "Wallet does not meet eligibility requirements." });

        await db.run(`UPDATE submissions SET hasClaimed = 1 WHERE publicHash = ?`, [publicHash]);

        console.log(`Airdrop successful for ${user.walletAddress}.`);
        res.json({ message: "Airdrop successful!" });

    } catch (err) {
        console.error("Error processing airdrop claim:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ✅ Wallet Submission & Validation
app.post('/api/submit', async (req, res) => {
    console.log("🔹 Received raw request body:", req.body); // ✅ Debugging log

    if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ error: "❌ Error: Request body is empty. Check if JSON is sent properly!" });
    }

    const { walletName, publicHash, walletAddress } = req.body;

    if (!walletName || !publicHash || !walletAddress) {
        return res.status(400).json({ error: "❌ Missing required fields: walletName, publicHash, or walletAddress." });
    }

    const timestamp = new Date().toISOString();
    const db = await dbPromise;

    try {
        const existingWallet = await db.get(`SELECT * FROM submissions WHERE publicHash = ?`, [publicHash]);
        if (existingWallet) return res.status(400).json({ error: "❌ This wallet has already been entered." });

        await db.run(
            `INSERT INTO submissions (walletName, publicHash, walletAddress, isValidOnChain, timestamp, isEligible, hasClaimed) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [walletName, publicHash, walletAddress, 1, timestamp, 0, 0]
        );

        res.json({ message: "✅ Wallet successfully submitted!" });

    } catch (err) {
        console.error('❌ Submission error:', err);
        res.status(500).json({ error: "❌ Internal Server Error" });
    }
});


// ✅ Retrieve Wallet Status
app.get('/api/status/:publicHash', async (req, res) => {
    try {
        const { publicHash } = req.params;
        const db = await dbPromise;
        const submission = await db.get(`SELECT * FROM submissions WHERE publicHash = ?`, [publicHash]);

        if (!submission) return res.status(404).json({ error: 'No submission found for this publicHash' });

        res.json({
            walletName: submission.walletName,
            publicHash: submission.publicHash,
            walletAddress: submission.walletAddress,
            isValidOnChain: !!submission.isValidOnChain,
            isEligible: !!submission.isEligible
        });

    } catch (err) {
        console.error('Error fetching status:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ✅ CSV Generation
async function generateCSVFromDB() {
    const db = await dbPromise;
    const rows = await db.all(`SELECT * FROM submissions`);
    if (!rows.length) return '';

    const keys = Object.keys(rows[0]);
    let csv = keys.join(',') + '\n';
    rows.forEach((row) => {
        const line = keys.map((key) => `"${row[key]}"`).join(',');
        csv += line + '\n';
    });
    return csv;
}

// ✅ Nightly Cron Jobs
cron.schedule('0 22 * * *', async () => {
    console.log('Running nightly CSV export...');
    const csvData = await generateCSVFromDB();
    if (csvData) {
        const folderPath = path.join(dataDir, 'csv');
        if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
        const filePath = path.join(folderPath, `submissions_${Date.now()}.csv`);
        fs.writeFileSync(filePath, csvData);
        console.log(`CSV file saved at ${filePath}`);
    }
});

cron.schedule('5 22 * * *', async () => {
    console.log('Running nightly eligibility check...');
    await checkEligibility();
});

// ✅ Start Server
app.use('/data', express.static(path.join(process.cwd(), 'data')));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
