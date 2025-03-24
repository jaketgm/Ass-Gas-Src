import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

// generates a new keypair
const keypair = Keypair.generate();

// converts to base58
const secretKeyBase58 = bs58.encode(keypair.secretKey);

console.log("HOT_WALLET_SECRET:", secretKeyBase58);
