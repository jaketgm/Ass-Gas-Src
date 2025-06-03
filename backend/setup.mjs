#!/usr/bin/env node
/**
 * Solana Token Airdrop Platform Setup Script
 * This script helps initialize the platform by:
 * 1. Checking and installing dependencies
 * 2. Creating required directories
 * 3. Setting up environment variables
 * 4. Initializing the PostgreSQL database
 * 5. Running migrations from SQLite if needed
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import dotenv from 'dotenv';
import { initializeDatabase } from './database.mjs';

// Get directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const backendDir = path.resolve(rootDir, 'backend');
const dataDir = path.resolve(rootDir, 'data');
const envPath = path.resolve(backendDir, '.env');

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Check if PostgreSQL client is installed
function checkPostgresClient() {
  try {
    execSync('pg_isready --version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

// Check for required dependencies
function checkDependencies() {
  console.log('\n🔍 Checking dependencies...');
  
  // Check if Node.js version is compatible
  const nodeVersion = process.version.match(/^v(\d+)\./)[1];
  if (Number(nodeVersion) < 14) {
    console.error('❌ Node.js v14 or higher is required. Please upgrade your Node.js installation.');
    process.exit(1);
  } else {
    console.log('✅ Node.js version compatible:', process.version);
  }
  
  // Check for PostgreSQL client
  if (!checkPostgresClient()) {
    console.log('⚠️ PostgreSQL client not found. Database connectivity check will be skipped.');
  } else {
    console.log('✅ PostgreSQL client detected');
  }
  
  // Check npm packages
  try {
    const packageJsonPath = path.resolve(rootDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      console.log('✅ package.json found');
    } else {
      console.log('⚠️ package.json not found. Will create minimal package.json');
      createPackageJson();
    }
  } catch (error) {
    console.error('❌ Error checking npm packages:', error);
  }
}

// Create necessary directories
function createDirectories() {
  console.log('\n📁 Creating necessary directories...');
  
  const directories = [
    dataDir,
    path.resolve(dataDir, 'backups'),
    path.resolve(dataDir, 'csv')
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`✅ Created directory: ${dir}`);
    } else {
      console.log(`✅ Directory already exists: ${dir}`);
    }
  });
}

// Create or update .env file
function setupEnvironment() {
  return new Promise((resolve) => {
    console.log('\n⚙️ Setting up environment variables...');
    
    const defaultEnv = {
      // Server Configuration
      PORT: '3001',
      NODE_ENV: 'development',
      API_VERSION: 'v1',
      FRONTEND_URL: 'http://localhost:3000',
      
      // Database Configuration
      PG_HOST: 'localhost',
      PG_PORT: '5432',
      PG_DATABASE: 'airdrop',
      PG_USER: 'postgres',
      PG_PASSWORD: 'postgres',
      
      // Solana Configuration
      SOLANA_API_URL: 'https://api.mainnet-beta.solana.com',
      HOT_WALLET_SECRET: '', // To be filled by user
      TOKEN_MINT_ADDRESS: '', // To be filled by user
      MIN_TOKEN_AMOUNT: '1',
      REQUIRED_HOLDING_MONTHS: '3',
      AIRDROP_AMOUNT: '1000',
      
      // Security Configuration
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_MAX_REQUESTS: '30',
      SIGNATURE_EXPIRY_MINUTES: '10'
    };
    
    // Check if .env file exists
    let currentEnv = {};
    if (fs.existsSync(envPath)) {
      console.log('📄 .env file found, loading existing configuration...');
      currentEnv = dotenv.parse(fs.readFileSync(envPath));
    }
    
    // Combine existing and default values
    const envVars = { ...defaultEnv, ...currentEnv };
    
    // Ask for missing critical values
    if (!envVars.HOT_WALLET_SECRET) {
      rl.question('Enter your Solana hot wallet secret key (base58 encoded): ', (answer) => {
        envVars.HOT_WALLET_SECRET = answer;
        if (!envVars.TOKEN_MINT_ADDRESS) {
          rl.question('Enter your token mint address: ', (answer) => {
            envVars.TOKEN_MINT_ADDRESS = answer;
            writeEnvFile(envVars);
            resolve();
          });
        } else {
          writeEnvFile(envVars);
          resolve();
        }
      });
    } else if (!envVars.TOKEN_MINT_ADDRESS) {
      rl.question('Enter your token mint address: ', (answer) => {
        envVars.TOKEN_MINT_ADDRESS = answer;
        writeEnvFile(envVars);
        resolve();
      });
    } else {
      writeEnvFile(envVars);
      resolve();
    }
  });
}

// Write the .env file
function writeEnvFile(envVars) {
  let envContent = '# Solana Token Airdrop Platform Configuration\n\n';
  
  // Server Configuration
  envContent += '# Server Configuration\n';
  envContent += `PORT=${envVars.PORT}\n`;
  envContent += `NODE_ENV=${envVars.NODE_ENV}\n`;
  envContent += `API_VERSION=${envVars.API_VERSION}\n`;
  envContent += `FRONTEND_URL=${envVars.FRONTEND_URL}\n\n`;
  
  // Database Configuration
  envContent += '# Database Configuration\n';
  envContent += `PG_HOST=${envVars.PG_HOST}\n`;
  envContent += `PG_PORT=${envVars.PG_PORT}\n`;
  envContent += `PG_DATABASE=${envVars.PG_DATABASE}\n`;
  envContent += `PG_USER=${envVars.PG_USER}\n`;
  envContent += `PG_PASSWORD=${envVars.PG_PASSWORD}\n\n`;
  
  // Solana Configuration
  envContent += '# Solana Configuration\n';
  envContent += `SOLANA_API_URL=${envVars.SOLANA_API_URL}\n`;
  envContent += `HOT_WALLET_SECRET=${envVars.HOT_WALLET_SECRET}\n`;
  envContent += `TOKEN_MINT_ADDRESS=${envVars.TOKEN_MINT_ADDRESS}\n`;
  envContent += `MIN_TOKEN_AMOUNT=${envVars.MIN_TOKEN_AMOUNT}\n`;
  envContent += `REQUIRED_HOLDING_MONTHS=${envVars.REQUIRED_HOLDING_MONTHS}\n`;
  envContent += `AIRDROP_AMOUNT=${envVars.AIRDROP_AMOUNT}\n\n`;
  
  // Security Configuration
  envContent += '# Security Configuration\n';
  envContent += `RATE_LIMIT_WINDOW_MS=${envVars.RATE_LIMIT_WINDOW_MS}\n`;
  envContent += `RATE_LIMIT_MAX_REQUESTS=${envVars.RATE_LIMIT_MAX_REQUESTS}\n`;
  envContent += `SIGNATURE_EXPIRY_MINUTES=${envVars.SIGNATURE_EXPIRY_MINUTES}\n`;
  
  fs.writeFileSync(envPath, envContent);
  console.log('✅ Environment configuration saved to .env file');
}

// Create minimal package.json if missing
function createPackageJson() {
  const packageJson = {
    "name": "solana-airdrop-platform",
    "version": "1.0.0",
    "description": "Secure, scalable backend system for Solana token airdrops",
    "main": "backend/script.mjs",
    "type": "module",
    "scripts": {
      "start": "node backend/script.mjs",
      "migrate": "node backend/migrate.mjs",
      "setup": "node backend/setup.mjs"
    },
    "dependencies": {
      "@solana/spl-token": "^0.3.8",
      "@solana/web3.js": "^1.78.0",
      "bs58": "^5.0.0",
      "compression": "^1.7.4",
      "cors": "^2.8.5",
      "dotenv": "^16.3.1",
      "express": "^4.18.2",
      "express-rate-limit": "^6.9.0",
      "helmet": "^7.0.0",
      "node-cron": "^3.0.2",
      "node-fetch": "^3.3.2",
      "pg": "^8.11.3",
      "sqlite": "^5.0.1",
      "sqlite3": "^5.1.6",
      "tweetnacl": "^1.0.3"
    },
    "engines": {
      "node": ">=14.0.0"
    }
  };
  
  fs.writeFileSync(
    path.resolve(rootDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
  console.log('✅ Created minimal package.json');
}

// Initialize database
async function setupDatabase() {
  console.log('\n🗄️ Initializing database...');
  
  try {
    await initializeDatabase();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    console.log('⚠️ Please check your PostgreSQL connection settings in the .env file');
  }
}

// Run migrations if needed
function runMigrations() {
  return new Promise((resolve) => {
    rl.question('\nDo you want to migrate data from SQLite to PostgreSQL? (y/n): ', async (answer) => {
      if (answer.toLowerCase() === 'y') {
        console.log('\n🔄 Running migration from SQLite to PostgreSQL...');
        try {
          const { default: migrate } = await import('./migrate.mjs');
          resolve();
        } catch (error) {
          console.error('❌ Migration failed:', error);
          resolve();
        }
      } else {
        console.log('📝 Skipping data migration');
        resolve();
      }
    });
  });
}

// Install dependencies if needed
function installDependencies() {
  return new Promise((resolve) => {
    rl.question('\nDo you want to install/update npm dependencies? (y/n): ', (answer) => {
      if (answer.toLowerCase() === 'y') {
        console.log('\n📦 Installing dependencies...');
        try {
          execSync('npm install', { stdio: 'inherit', cwd: rootDir });
          console.log('✅ Dependencies installed successfully');
        } catch (error) {
          console.error('❌ Dependency installation failed:', error);
        }
      } else {
        console.log('📝 Skipping dependency installation');
      }
      resolve();
    });
  });
}

// Main setup function
async function setup() {
  console.log('\n🚀 Welcome to the Solana Token Airdrop Platform Setup\n');
  
  // Run setup steps
  checkDependencies();
  createDirectories();
  await installDependencies();
  await setupEnvironment();
  await setupDatabase();
  await runMigrations();
  
  console.log('\n✨ Setup completed successfully!');
  console.log('\nTo start the server, run:');
  console.log('npm start');
  
  rl.close();
}

// Run setup
setup().catch(error => {
  console.error('❌ Setup failed:', error);
  rl.close();
  process.exit(1);
});
