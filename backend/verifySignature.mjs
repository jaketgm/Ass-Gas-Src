import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

export async function createMessageToSign(walletAddress) {
    const timestamp = Date.now();
    const message = `Verify wallet ownership for airdrop: ${walletAddress} at ${timestamp}`;
    return {
        message,
        timestamp
    };
}

export async function verifySignature(walletAddress, signature, signedMessage, timestamp) {
    try {
        const publicKey = new PublicKey(walletAddress);
        const messageBytes = new TextEncoder().encode(
            `Verify wallet ownership for airdrop: ${walletAddress} at ${timestamp}`
        );
        
        const signatureBytes = bs58.decode(signature);
        const verified = nacl.sign.detached.verify(
            messageBytes,
            signatureBytes,
            publicKey.toBytes()
        );
        
        // Verify signature is recent (within 5 minutes)
        const now = Date.now();
        const signatureAge = now - timestamp;
        const isRecent = signatureAge < 5 * 60 * 1000; // 5 minutes in milliseconds
        
        return verified && isRecent;
    } catch (error) {
        return false;
    }
}
