import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';

async function addOrRenameColumns() {
    const dbPath = path.join(process.cwd(), 'data', 'submissions.db');
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database,
    });

    try {
        // Retrieve existing columns in the "submissions" table
        const tableInfo = await db.all("PRAGMA table_info('submissions')");
        const columnNames = tableInfo.map(col => col.name);

        // Rename "email" to "walletName" if necessary
        if (columnNames.includes('email') && !columnNames.includes('walletName')) {
            await db.exec(`
                ALTER TABLE submissions
                RENAME COLUMN email TO walletName
            `);
            console.log('Renamed "email" column to "walletName".');
        }

        // Add missing columns if they do not exist
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
                await db.exec(`
                    ALTER TABLE submissions
                    ADD COLUMN ${column.name} ${column.type}
                `);
                console.log(`Added "${column.name}" column.`);
            }
        }

        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Error during migration:', error);
    } finally {
        await db.close();
    }
}

addOrRenameColumns();
