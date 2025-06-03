import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

const { Pool } = pg;

const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.NODE_ENV === 'production',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

export async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                walletName VARCHAR(100) NOT NULL,
                publicHash VARCHAR(100) NOT NULL UNIQUE,
                walletAddress VARCHAR(100) NOT NULL,
                isValidOnChain BOOLEAN DEFAULT FALSE,
                timestamp TIMESTAMP NOT NULL,
                isEligible BOOLEAN DEFAULT FALSE,
                hasClaimed BOOLEAN DEFAULT FALSE,
                signatureVerified BOOLEAN DEFAULT FALSE,
                lastChecked TIMESTAMP,
                recoveryKey VARCHAR(100)
            )
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_publicHash ON submissions(publicHash)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_walletAddress ON submissions(walletAddress)
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_eligibility ON submissions(isEligible, hasClaimed)
        `);
        
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

export async function query(text, params) {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (duration > 500) {
        console.log('Slow query detected:', { text, duration, rows: res.rowCount });
    }
    
    return res;
}

export async function getClient() {
    const client = await pool.connect();
    const originalRelease = client.release;
    
    client.release = () => {
        client.release = originalRelease;
        return originalRelease.apply(client);
    };
    
    return client;
}

export async function createBackup() {
    const client = await pool.connect();
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(process.cwd(), 'data', 'backups');
        
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        
        const backupPath = path.join(backupDir, `db_backup_${timestamp}.sql`);
        const result = await client.query('SELECT * FROM submissions');
        
        let backupContent = 'INSERT INTO submissions (walletName, publicHash, walletAddress, isValidOnChain, timestamp, isEligible, hasClaimed, signatureVerified, lastChecked, recoveryKey) VALUES\n';
        
        const rows = result.rows.map(row => {
            return `('${row.walletname}', '${row.publichash}', '${row.walletaddress}', 
                ${row.isvalidonchain}, '${row.timestamp}', ${row.iseligible}, 
                ${row.hasclaimed}, ${row.signatureverified || false}, 
                ${row.lastchecked ? `'${row.lastchecked}'` : 'NULL'}, 
                ${row.recoverykey ? `'${row.recoverykey}'` : 'NULL'})`;
        }).join(',\n');
        
        backupContent += rows + ';';
        fs.writeFileSync(backupPath, backupContent);
        
        return backupPath;
    } finally {
        client.release();
    }
}
