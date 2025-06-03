# Solana Airdrop Platform: Simple Deployment Guide

This guide will help you deploy the Solana airdrop platform using modern cloud services without any server management. Perfect for non-technical users!

## What You'll Need

- A computer with internet access
- GitHub account (free)
- Fly.io account (free tier available)
- Neon or Supabase account for database (free tier available)
- Solana wallet with tokens for airdrops
- About 30-60 minutes of your time

## Step 1: Set Up Your Database

1. Go to [Neon](https://neon.tech) and sign up for a free account
2. Click "Create New Project"
3. Give your project a name (e.g., "solana-airdrop")
4. Choose the region closest to you
5. Click "Create Project"
6. On the next screen, you'll see your database connection details:
   - Save the "Connection String" somewhere safe (you'll need it later)
   - It looks like: `postgres://user:password@host:port/database`

## Step 2: Create a Solana Wallet for Airdrops

1. On your computer, open a terminal/command prompt
2. Navigate to the project folder:
   ```
   cd path/to/Ass-Gas-Src/backend
   ```
3. Run the wallet generation script:
   ```
   node generate-wallet.mjs
   ```
4. Follow the on-screen instructions
5. IMPORTANT: Save both the public key and secret key somewhere very safe
6. Fund this wallet with:
   - SOL for transaction fees (at least 0.5 SOL)
   - Your SPL tokens that will be airdropped

## Step 3: Deploy the Backend to Fly.io

1. Install the Fly.io command line tool:
   - On Windows: Open PowerShell and run:
     ```
     iwr https://fly.io/install.ps1 -useb | iex
     ```
   - On Mac: Open Terminal and run:
     ```
     curl -L https://fly.io/install.sh | sh
     ```

2. Sign up and log in:
   ```
   fly auth signup
   ```
   (Follow the browser prompts to create your account)

3. Navigate to your backend directory:
   ```
   cd path/to/Ass-Gas-Src/backend
   ```

4. Launch your app on Fly.io:
   ```
   fly launch
   ```
   - Choose a unique app name (e.g., "my-solana-airdrop")
   - Select the region closest to you
   - Say "No" when asked to setup Postgres (we already have one)
   - Say "No" to setting up Redis
   - Select "Deploy now" when asked

5. Once deployed, add your environment variables:
   ```
   fly secrets set \
     PG_CONNECTION_STRING="your_postgres_connection_string" \
     SOLANA_API_URL="https://api.mainnet-beta.solana.com" \
     TOKEN_MINT_ADDRESS="your_token_mint_address" \
     AIRDROP_AMOUNT="1000" \
     HOT_WALLET_SECRET_KEY="your_wallet_secret_key" \
     ADMIN_API_TOKEN="create_a_random_secure_password_here" \
     FRONTEND_URL="https://your-frontend-url.com"
   ```
   
   Replace all the values in quotes with your actual information.
   
   - For SOLANA_API_URL, you can use a free RPC provider like the default one shown above
   - For TOKEN_MINT_ADDRESS, use the address of your SPL token
   - For HOT_WALLET_SECRET_KEY, use the secret key from Step 2
   - For ADMIN_API_TOKEN, create a strong random password
   - For FRONTEND_URL, you can leave it as is for now and update later

6. Deploy your changes:
   ```
   fly deploy
   ```

7. Once complete, your backend is live! Note the URL shown in the output (something like `https://my-solana-airdrop.fly.dev`)

## Step 4: Initialize Your Database

1. Create a temporary .env file in your backend directory:
   ```
   echo PG_CONNECTION_STRING="your_postgres_connection_string" > .env
   ```
   (Replace with your actual connection string from Step 1)

2. Run the setup script to initialize your database:
   ```
   node setup.mjs
   ```

3. Run the verification script to check everything is working:
   ```
   node verify.mjs
   ```
   
   If you see any errors, double-check your environment variables and try again.

## Step 5: Deploy Your Frontend (If You Have One)

If you have a frontend application:

1. Install the Vercel CLI:
   ```
   npm install -g vercel
   ```

2. Log in to Vercel:
   ```
   vercel login
   ```

3. Navigate to your frontend directory and deploy:
   ```
   cd path/to/frontend
   vercel
   ```

4. Follow the prompts to deploy your frontend
   
5. In the Vercel dashboard, add your backend URL as an environment variable:
   - Go to your project
   - Click "Settings" > "Environment Variables"
   - Add `REACT_APP_API_URL` or `NEXT_PUBLIC_API_URL` with the value of your Fly.io backend URL

## Step 6: Test Your Deployment

1. Visit your frontend URL or test your backend API directly:
   ```
   curl https://your-fly-app.fly.dev/api/v1/ping
   ```

2. Use the admin endpoints to check system status:
   ```
   curl -H "X-Admin-Token: your_admin_token" https://your-fly-app.fly.dev/api/v1/admin/stats
   ```

## Maintenance and Monitoring

1. Check your application logs:
   ```
   fly logs
   ```

2. Monitor your hot wallet balance regularly through the admin endpoint:
   ```
   curl -H "X-Admin-Token: your_admin_token" https://your-fly-app.fly.dev/api/v1/admin/wallet-status
   ```

3. When you need to update your application:
   ```
   cd path/to/backend
   git pull  # If you're using git to manage updates
   fly deploy
   ```

## Important Notes

- **Security**: Keep your hot wallet secret key and admin token secure
- **Monitoring**: Check your wallet balance regularly to ensure it has enough tokens
- **Costs**: 
  - Fly.io offers a generous free tier (3 small VMs)
  - Neon offers a free tier for PostgreSQL
  - Additional costs will apply if you exceed free tier limits
- **Backups**: Your database provider handles backups automatically

## Troubleshooting

- **Database connection issues**: Double-check your connection string
- **Deployment failures**: Try `fly deploy` again or check `fly logs`
- **Wallet errors**: Ensure your hot wallet has sufficient SOL for fees and tokens for airdrops

If you need more help, contact the developer who created this application.
