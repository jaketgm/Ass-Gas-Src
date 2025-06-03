import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { initializeDatabase, query } from './database.mjs';

dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

async function migrateSqliteToPostgres() {
    console.log('Starting migration from SQLite to PostgreSQL...');
    
    const sqliteDbPath = path.join(process.cwd(), 'data', 'submissions.db');
    
    if (!fs.existsSync(sqliteDbPath)) {
        console.error(`SQLite database not found at ${sqliteDbPath}`);
        return false;
    }
    
    try {
        // Open SQLite database
        const sqliteDb = await open({
            filename: sqliteDbPath,
            driver: sqlite3.Database
        });
        
        // Get all records from SQLite
        const rows = await sqliteDb.all('SELECT * FROM submissions');
        console.log(`Found ${rows.length} records to migrate`);
        
        if (rows.length === 0) {
            console.log('No records to migrate');
            return true;
        }
        
        // Initialize PostgreSQL database
        await initializeDatabase();
        
        // Migrate records one by one to ensure proper error handling
        for (const row of rows) {
            try {
                await query(
                    `INSERT INTO submissions (
                        walletName, publicHash, walletAddress, isValidOnChain, 
                        timestamp, isEligible, hasClaimed
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (publicHash) DO NOTHING`,
                    [
                        row.walletName,
                        row.publicHash,
                        row.walletAddress,
                        !!row.isValidOnChain,
                        new Date(row.timestamp),
                        !!row.isEligible,
                        !!row.hasClaimed
                    ]
                );
            } catch (error) {
                console.error(`Error migrating record for wallet ${row.walletAddress}:`, error);
            }
        }
        
        console.log('Migration completed successfully');
        return true;
    } catch (error) {
        console.error('Migration failed:', error);
        return false;
    }
}

async function ensureSqliteColumns() {
    const dbPath = path.join(process.cwd(), 'data', 'submissions.db');
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    try {
        // Create table if not exists
        await db.exec(`
            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                walletName TEXT,
                publicHash TEXT UNIQUE,
                walletAddress TEXT,
                isValidOnChain INTEGER DEFAULT 0,
                isEligible INTEGER DEFAULT 0,
                hasClaimed INTEGER DEFAULT 0
            )
        `);

        // Retrieve existing columns
        const tableInfo = await db.all("PRAGMA table_info('submissions')");
        const columnNames = tableInfo.map(col => col.name);

        // Add missing columns if needed
        const columnsToAdd = [
            { name: 'walletName', type: 'TEXT' },
            { name: 'publicHash', type: 'TEXT UNIQUE' },
            { name: 'walletAddress', type: 'TEXT' },
            { name: 'isValidOnChain', type: 'INTEGER DEFAULT 0' },
            { name: 'isEligible', type: 'INTEGER DEFAULT 0' },
            { name: 'hasClaimed', type: 'INTEGER DEFAULT 0' }
        ];

        for (const column of columnsToAdd) {
            if (!columnNames.includes(column.name)) {
                await db.exec(`ALTER TABLE submissions ADD COLUMN ${column.name} ${column.type}`);
            }
        }
    } finally {
        await db.close();
    }
}

async function main() {
    try {
        // First ensure SQLite DB is properly structured
        await ensureSqliteColumns();
        
        // Then migrate to PostgreSQL
        await migrateSqliteToPostgres();
        
        console.log('Migration completed successfully');
        process.exit(0);
    } catch (error) {
        console.error('Migration script failed:', error);
        process.exit(1);
    }
}

main();
