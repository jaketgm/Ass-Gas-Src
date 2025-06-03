import express from 'express';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';

import validateWallets from './validateWallets.mjs';
import checkEligibility from './checkEligibility.mjs';
import { validateSubmissionBody, validatePublicHash } from './validators.mjs';
import { initializeDatabase, query, getClient, createBackup } from './database.mjs';
import { createMessageToSign, verifySignature } from './verifySignature.mjs';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const apiVersion = process.env.API_VERSION || 'v1';
const API_BASE = `/api/${apiVersion}`;

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.disable('x-powered-by');
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

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

// Initialize database and create backup directories
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const backupDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

// Initialize PostgreSQL database
initializeDatabase().catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});

// ✅ CoinGecko API Proxy with Rate-Limiting & Caching
const cache = {};
const CACHE_TTL_MS = 60_000; // Cache expiration time (60 seconds)

// Global rate limiter for all API routes
const apiLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
});

// More restrictive limiter for sensitive operations
const submitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 requests per hour
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many wallet submissions, please try again later.' },
});

// CoinGecko API specific limiter
const cgLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests to CoinGecko, please slow down.' },
});

app.use(express.json({ limit: '100kb' })); // ✅ Parses incoming JSON requests with size limit
app.use(express.urlencoded({ extended: true, limit: '100kb' })); // ✅ Handles form submissions with size limit

// Apply rate limiting to all /api routes
app.use('/api', apiLimiter);

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

// Endpoint to get a message that needs to be signed to verify wallet ownership
app.get(`${API_BASE}/signatureChallenge/:walletAddress`, async (req, res) => {
    try {
        const { walletAddress } = req.params;
        
        if (!validatePublicHash(walletAddress)) {
            return res.status(400).json({ error: "Invalid wallet address format" });
        }
        
        const { message, timestamp } = await createMessageToSign(walletAddress);
        res.json({ message, timestamp });
    } catch (err) {
        console.error("Error creating signature challenge:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// Airdrop claiming with signature verification and token transfer
app.post(`${API_BASE}/collectAirdrop`, submitLimiter, async (req, res) => {
    const client = await getClient();
    
    try {
        await client.query('BEGIN');
        
        // Required fields: walletAddress, signature, timestamp
        const { walletAddress, signature, timestamp } = req.body;
        
        // Validate inputs
        if (!walletAddress || !signature || !timestamp) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        // Parse timestamp
        const messageTimestamp = new Date(timestamp);
        const now = new Date();
        
        // Check if timestamp is within allowed window (e.g., 10 minutes)
        const timeDiffMinutes = (now - messageTimestamp) / (1000 * 60);
        const maxTimeDiffMinutes = parseInt(process.env.SIGNATURE_EXPIRY_MINUTES || '10');
        
        if (timeDiffMinutes < 0 || timeDiffMinutes > maxTimeDiffMinutes) {
            return res.status(400).json({ 
                error: `Invalid timestamp. Signature must be from the last ${maxTimeDiffMinutes} minutes.` 
            });
        }
        
        // Create the message that should have been signed
        const message = `Verify wallet ownership for airdrop: ${walletAddress} at ${timestamp}`;
        
        // Verify the signature
        if (!verifySignature(walletAddress, message, signature)) {
            return res.status(401).json({ error: 'Invalid signature' });
        }
        
        // Check if wallet is eligible and has not claimed
        const { rows } = await client.query(
            `SELECT iseligible, hasclaimed FROM submissions 
             WHERE walletaddress = $1 FOR UPDATE`,
            [walletAddress]
        );
        
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Wallet not found' });
        }
        
        if (!rows[0].iseligible) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Wallet is not eligible for airdrop' });
        }
        
        if (rows[0].hasclaimed) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Airdrop already claimed' });
        }
        
        // Update claim status in database
        await client.query(
            `UPDATE submissions SET hasclaimed = true, claimtimestamp = NOW() 
             WHERE walletaddress = $1`,
            [walletAddress]
        );
        
        // Commit the database transaction
        await client.query('COMMIT');
        
        // Import and call the transaction handler
        try {
            const { transferTokens } = await import('./transaction-handler.mjs');
            
            // Execute the token transfer (non-blocking)
            transferTokens(walletAddress)
                .then(result => {
                    if (result.success) {
                        console.log(`Token transfer successful: ${result.signature}`);
                        
                        // Update transaction hash in database
                        getClient().then(async (updateClient) => {
                            try {
                                await updateClient.query(
                                    `UPDATE submissions SET transactionhash = $1 
                                     WHERE walletaddress = $2`,
                                    [result.signature, walletAddress]
                                );
                            } finally {
                                updateClient.release();
                            }
                        });
                    } else {
                        console.error(`Token transfer failed: ${result.error}`);
                    }
                })
                .catch(error => {
                    console.error('Error in token transfer:', error);
                });
            
            // Return success response immediately without waiting for transfer
            res.json({
                success: true,
                message: 'Airdrop claim processing initiated',
                walletAddress,
                amount: parseInt(process.env.AIRDROP_AMOUNT || '1000'),
                timestamp: new Date()
            });
            
        } catch (transferErr) {
            console.error('Error importing transaction handler:', transferErr);
            // Still return success since the claim was recorded
            res.json({
                success: true,
                message: 'Airdrop claim recorded, token transfer queued',
                walletAddress,
                timestamp: new Date()
            });
        }
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackErr) {
            console.error('Error during rollback:', rollbackErr);
        }
        console.error("Error processing airdrop claim:", err);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
});

// Wallet Submission endpoint with improved validation and PostgreSQL integration
app.post(`${API_BASE}/submit`, submitLimiter, async (req, res) => {
    const client = await getClient();
    
    try {
        await client.query('BEGIN');
        
        // Validate input
        const validBody = validateSubmissionBody(req.body);
        if (!validBody.valid) {
            return res.status(400).json({ error: validBody.error });
        }

        const { walletName, publicHash } = req.body;
        const timestamp = new Date();

        // Validate the wallet on-chain
        const isValidOnChain = await validateWallets(publicHash);

        // Check if wallet already exists
        const { rows } = await client.query(
            'SELECT * FROM submissions WHERE publichash = $1',
            [publicHash]
        );

        if (rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "This wallet has already been registered" });
        }

        // Insert into database
        await client.query(
            `INSERT INTO submissions (
                walletname, publichash, walletaddress, isvalidonchain, 
                timestamp, iseligible, hasclaimed
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [walletName, publicHash, publicHash, isValidOnChain, timestamp, false, false]
        );
        
        // Generate a message for the user to sign to verify wallet ownership
        const { message, timestamp: signatureTimestamp } = await createMessageToSign(publicHash);
        
        await client.query('COMMIT');

        // Mask sensitive data in logs and response
        const maskedHash = `${publicHash.slice(0, 6)}...${publicHash.slice(-4)}`;
        console.log(`New wallet registered: ${maskedHash}`);

        res.json({
            message: "Wallet submitted successfully!",
            timestamp,
            wallet: maskedHash,
            verification: {
                message,
                timestamp: signatureTimestamp,
                instructions: "Please sign this message with your wallet to verify ownership"
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Error processing submission:", err);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
});

// Endpoint to verify wallet ownership
app.post(`${API_BASE}/verify-ownership`, submitLimiter, async (req, res) => {
    const client = await getClient();
    
    try {
        const { walletAddress, signature, timestamp } = req.body;
        
        if (!walletAddress || !signature || !timestamp) {
            return res.status(400).json({ 
                error: "Missing required fields: walletAddress, signature, or timestamp" 
            });
        }
        
        // Verify the signature
        const message = `Verify wallet ownership: ${walletAddress} at ${timestamp}`;
        const isValid = await verifySignature(walletAddress, signature, message, timestamp);
        
        if (!isValid) {
            return res.status(401).json({ error: "Invalid signature or expired timestamp" });
        }
        
        // Update the database to mark this wallet as verified
        await client.query(
            'UPDATE submissions SET signatureverified = true WHERE walletaddress = $1',
            [walletAddress]
        );
        
        res.json({ 
            message: "Wallet ownership verified successfully",
            status: "success",
            verified: true,
            timestamp: new Date()
        });
    } catch (err) {
        console.error("Error verifying wallet ownership:", err);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
});

// Helper function to get wallet status
async function getWalletStatus(publicHash, res) {
    const client = await getClient();
    
    try {
        // Validate the public hash parameter
        const validHash = validatePublicHash(publicHash);
        if (!validHash) {
            return res.status(400).json({ error: 'Invalid public hash format' });
        }
        
        // Use parameterized query with PostgreSQL
        const { rows } = await client.query(
            `SELECT walletname, publichash, walletaddress, isvalidonchain, iseligible, signatureverified, 
                    hasclaimed, timestamp
             FROM submissions WHERE publichash = $1`,
            [validHash]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'No submission found for this public hash' });
        }

        const submission = rows[0];
        
        // Return sanitized data without exposing entire DB row
        res.json({
            walletName: submission.walletname,
            publicHash: submission.publichash,
            // Mask part of the wallet address for privacy
            walletAddress: `${submission.walletaddress.substring(0, 4)}...${submission.walletaddress.substring(submission.walletaddress.length - 4)}`,
            isValidOnChain: !!submission.isvalidonchain,
            isEligible: !!submission.iseligible,
            isVerified: !!submission.signatureverified,
            hasClaimed: !!submission.hasclaimed,
            registrationDate: submission.timestamp,
            timestamp: new Date()
        });
    } catch (err) {
        console.error('Error fetching status:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    } finally {
        client.release();
    }
}

// New versioned API endpoint for wallet status
app.get(`${API_BASE}/status/:publicHash`, (req, res) => {
    getWalletStatus(req.params.publicHash, res);
});

// Legacy endpoint for backward compatibility
app.get('/api/status/:publicHash', (req, res) => {
    console.log('Warning: Using deprecated API endpoint /api/status/:publicHash');
    getWalletStatus(req.params.publicHash, res);
});

// CSV Generation with PostgreSQL
async function generateCSVFromDB() {
    const client = await getClient();
    
    try {
        const { rows } = await client.query('SELECT * FROM submissions');
        if (!rows.length) return '';

        // Convert PostgreSQL column names to lowercase to ensure consistency
        const keys = Object.keys(rows[0]);
        let csv = keys.join(',') + '\n';
        
        rows.forEach((row) => {
            const line = keys.map((key) => {
                // Format dates properly and handle nulls
                if (row[key] instanceof Date) {
                    return `"${row[key].toISOString()}"`;
                } else if (row[key] === null || row[key] === undefined) {
                    return '""';
                } else {
                    return `"${row[key]}"`;
                }
            }).join(',');
            csv += line + '\n';
        });
        
        return csv;
    } catch (error) {
        console.error('Error generating CSV:', error);
        return '';
    } finally {
        client.release();
    }
}

// Database backup cron job
cron.schedule('0 1 * * *', async () => {
    console.log('Running nightly database backup...');
    try {
        await createBackup();
        console.log('Database backup completed successfully');
    } catch (error) {
        console.error('Database backup failed:', error);
    }
});

// CSV export cron job
cron.schedule('0 2 * * *', async () => {
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

// Eligibility check cron job
cron.schedule('0 3 * * *', async () => {
    console.log('Running nightly eligibility check...');
    await checkEligibility();
});

// ✅ Secure CSV Export Endpoint (replacing direct data directory access)
app.get('/api/export/:csvFileName', async (req, res) => {
    try {
        // Validate filename to prevent directory traversal attacks
        const fileName = req.params.csvFileName;
        if (!fileName.match(/^submissions_\d+\.csv$/)) {
            return res.status(400).json({ error: 'Invalid file name format' });
        }

        const filePath = path.join(dataDir, 'csv', fileName);
        
        // Check if file exists and is within the allowed directory
        const realPath = path.resolve(filePath);
        const csvDir = path.resolve(path.join(dataDir, 'csv'));
        
        if (!realPath.startsWith(csvDir) || !fs.existsSync(realPath)) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        // Send file with proper content type
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        fs.createReadStream(realPath).pipe(res);
    } catch (err) {
        console.error('Error serving CSV file:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Admin middleware for securing admin endpoints
const adminAuth = (req, res, next) => {
    const adminToken = req.headers['x-admin-token'];
    const expectedToken = process.env.ADMIN_API_TOKEN;
    
    if (!expectedToken) {
        console.error('❌ ADMIN_API_TOKEN not set in environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    
    if (!adminToken || adminToken !== expectedToken) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    next();
};

// Admin-only endpoint for hot wallet status
app.get(`${API_BASE}/admin/wallet-status`, adminAuth, async (req, res) => {
    try {
        const { monitorHotWalletBalance, getTokenBalance } = await import('./transaction-handler.mjs');
        const { SecureWallet } = await import('./secure-wallet.mjs');
        
        // Initialize the hot wallet
        const wallet = new SecureWallet();
        await wallet.loadFromEnv();
        
        // Get token balance
        const tokenBalance = await getTokenBalance(wallet.publicKey.toString());
        
        // Check if balance is above threshold
        const threshold = parseInt(process.env.HOT_WALLET_MIN_BALANCE || '10000');
        const isLowBalance = await monitorHotWalletBalance(threshold);
        
        // Get total eligible but unclaimed airdrops
        const client = await getClient();
        try {
            const { rows } = await client.query(
                `SELECT COUNT(*) as pending_count, 
                        COUNT(*) * $1 as pending_tokens
                 FROM submissions 
                 WHERE iseligible = true AND hasclaimed = false`,
                [parseInt(process.env.AIRDROP_AMOUNT || '1000')]
            );
            
            const pendingCount = parseInt(rows[0].pending_count);
            const pendingTokens = parseInt(rows[0].pending_tokens);
            
            // Return wallet status with security-conscious information
            res.json({
                status: 'success',
                walletAddress: wallet.publicKey.toString(),
                tokenBalance,
                isLowBalance: !isLowBalance, // true if below threshold
                threshold,
                pendingAirdrops: pendingCount,
                pendingTokenAmount: pendingTokens,
                sufficientForPending: tokenBalance >= pendingTokens,
                timestamp: new Date()
            });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error getting hot wallet status:', err);
        res.status(500).json({ error: 'Failed to get hot wallet status' });
    }
});

// Admin-only endpoint for processing batch transfers
app.post(`${API_BASE}/admin/batch-transfer`, adminAuth, async (req, res) => {
    try {
        const { batchSize, processAll } = req.body;
        
        if (!batchSize && !processAll) {
            return res.status(400).json({ 
                error: 'Either batchSize or processAll must be specified' 
            });
        }
        
        const limit = processAll ? 1000 : parseInt(batchSize);
        
        // Get eligible wallets that haven't claimed yet
        const client = await getClient();
        try {
            const { rows } = await client.query(
                `SELECT walletaddress FROM submissions 
                 WHERE iseligible = true AND hasclaimed = false 
                 LIMIT $1`,
                [limit]
            );
            
            if (rows.length === 0) {
                return res.json({
                    status: 'success',
                    message: 'No pending airdrops to process',
                    processed: 0
                });
            }
            
            // Launch batch transfer process
            const recipients = rows.map(row => row.walletaddress);
            
            // Start the batch transfer in the background
            const { batchTransferTokens } = await import('./transaction-handler.mjs');
            
            // Return immediate response that the process has started
            res.json({
                status: 'success',
                message: 'Batch transfer initiated',
                recipientCount: recipients.length,
                timestamp: new Date()
            });
            
            // Execute batch transfer after response is sent
            batchTransferTokens(recipients)
                .then(results => {
                    const successful = results.filter(r => r.success).length;
                    const failed = results.length - successful;
                    
                    console.log(`Batch transfer completed: ${successful} successful, ${failed} failed`);
                })
                .catch(err => {
                    console.error('Error in batch transfer:', err);
                });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error initiating batch transfer:', err);
        res.status(500).json({ error: 'Failed to initiate batch transfer' });
    }
});

// Admin-only endpoint for system statistics
app.get(`${API_BASE}/admin/stats`, adminAuth, async (req, res) => {
    const client = await getClient();
    
    try {
        // Get overall statistics
        const stats = await client.query(`
            SELECT 
                COUNT(*) as total_submissions,
                SUM(CASE WHEN iseligible THEN 1 ELSE 0 END) as eligible_count,
                SUM(CASE WHEN hasclaimed THEN 1 ELSE 0 END) as claimed_count,
                SUM(CASE WHEN iseligible AND NOT hasclaimed THEN 1 ELSE 0 END) as pending_count
            FROM submissions
        `);
        
        // Get recent claims
        const recentClaims = await client.query(`
            SELECT 
                walletaddress, 
                claimtimestamp,
                transactionhash
            FROM submissions 
            WHERE hasclaimed = true 
            ORDER BY claimtimestamp DESC 
            LIMIT 10
        `);
        
        // Return statistics
        res.json({
            status: 'success',
            statistics: stats.rows[0],
            recentClaims: recentClaims.rows.map(row => ({
                walletAddress: row.walletaddress,
                claimTimestamp: row.claimtimestamp,
                transactionHash: row.transactionhash || 'pending'
            })),
            timestamp: new Date()
        });
    } catch (err) {
        console.error('Error fetching system statistics:', err);
        res.status(500).json({ error: 'Failed to fetch system statistics' });
    } finally {
        client.release();
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
