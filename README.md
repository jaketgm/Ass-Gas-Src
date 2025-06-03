# Solana Token Airdrop Platform

A secure, scalable backend system for validating Solana wallet eligibility and distributing token airdrops to qualified users.

## System Architecture

### Backend Components

- **API Layer**: Express.js REST API with versioning support
- **Database**: PostgreSQL with connection pooling for data persistence
- **Blockchain Integration**: Solana Web3.js for on-chain validation and token transfers
- **Security**: Comprehensive input validation, rate limiting, and cryptographic verification
- **Scheduled Jobs**: Automated eligibility checks, database backups, and reporting

### Security Features

- **Wallet Signature Verification**: Cryptographic proof of wallet ownership using message signing
- **Input Sanitization**: Thorough validation for all user inputs
- **Rate Limiting**: Tiered limits for different API endpoints
- **Security Headers**: HTTP security headers via Helmet middleware
- **Sensitive Data Protection**: Masking of private data in logs and responses
- **Transaction Safety**: Database transactions to prevent race conditions
- **Configuration Security**: Environment variables for sensitive configuration

## API Endpoints

### Wallet Registration

- `POST /api/v1/submit`
  - Registers a new wallet for airdrop eligibility
  - Requires wallet name and public address
  - Returns a challenge message for wallet ownership verification

### Wallet Verification

- `POST /api/v1/verify-ownership`
  - Verifies wallet ownership through cryptographic signature
  - Requires wallet address, signature, and timestamp

### Signature Challenge

- `GET /api/v1/signatureChallenge/:walletAddress`
  - Generates a challenge message for the wallet to sign
  - Returns message and timestamp for verification

### Airdrop Claiming

- `POST /api/v1/collectAirdrop`
  - Processes airdrop claim for eligible wallets
  - Requires wallet address, signature, and timestamp
  - Validates eligibility and signature before processing

### Wallet Status

- `GET /api/v1/status/:publicHash`
  - Returns current status of a registered wallet
  - Includes validation, eligibility, and verification status

## Eligibility Criteria

1. **Token Holding**: Wallet must hold a minimum quantity of specified tokens
2. **Holding Period**: Tokens must be held for a configurable period (default: 3 months)
3. **Wallet Verification**: Wallet ownership must be cryptographically verified
4. **On-chain Validation**: Wallet must be a valid Solana account with non-zero balance

## Automated Processes

- **Daily Eligibility Checks**: Evaluates all registered wallets against eligibility criteria
- **Database Backups**: Creates nightly backups of the PostgreSQL database
- **CSV Exports**: Generates reports of submissions for administrative purposes

## Deployment and Configuration

### Environment Variables

```
# Server Configuration
PORT=3001
NODE_ENV=production
API_VERSION=v1
FRONTEND_URL=https://your-frontend-url.com

# Database Configuration
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=airdrop
PG_USER=airdrop_user
PG_PASSWORD=secure_password

# Solana Configuration
SOLANA_API_URL=https://api.mainnet-beta.solana.com
HOT_WALLET_SECRET=your_hot_wallet_key_base58
TOKEN_MINT_ADDRESS=your_token_mint_address
MIN_TOKEN_AMOUNT=1
REQUIRED_HOLDING_MONTHS=3
AIRDROP_AMOUNT=1000

# Security Configuration
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=30
SIGNATURE_EXPIRY_MINUTES=10
```

### Database Migration

A migration script is provided to move from SQLite to PostgreSQL:

```bash
node backend/migrate.mjs
```

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `.env`
4. Run database migrations: `node backend/migrate.mjs`
5. Start the server: `npm start`

## Security Recommendations

1. Store hot wallet keys in a secure key management service (e.g., AWS Secrets Manager)
2. Use HTTPS in production with valid SSL certificates
3. Implement monitoring and alerting for suspicious activities
4. Regularly rotate API keys and access credentials
5. Deploy behind a load balancer with DDoS protection

## License

Proprietry software, all rights reserved.
