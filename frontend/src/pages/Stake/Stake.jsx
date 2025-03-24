import React, { useState, useEffect } from 'react';
import './Stake.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useWallet } from '@solana/wallet-adapter-react';

const Stake = () => {
    const { publicKey } = useWallet();
    const [walletName, setWalletName] = useState('');
    const [publicHash, setPublicHash] = useState('');
    const [status, setStatus] = useState(null);
    const [loadingStatus, setLoadingStatus] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    const fetchStatus = async (pubHash) => {
        try {
            setLoadingStatus(true);
            setErrorMessage('');
            const response = await fetch(`/api/status/${pubHash}`);
            if (!response.ok) {
                throw new Error('Failed to fetch status');
            }
            const data = await response.json();
            setStatus(data);
        } catch (error) {
            console.error('Error fetching status:', error);
            setStatus(null);
            setErrorMessage('Failed to retrieve wallet status. Please try again.');
        } finally {
            setLoadingStatus(false);
        }
    };

    useEffect(() => {
        if (publicHash) {
            fetchStatus(publicHash);
        }
    }, [publicHash]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');

        if (!walletName.trim() || !publicHash.trim()) {
            setErrorMessage('Please enter both a wallet name and public hash.');
            return;
        }

        if (!publicKey) {
            setErrorMessage('Please connect your wallet before submitting.');
            return;
        }

        const payload = {
            walletName,
            publicHash,
            walletAddress: publicKey.toBase58(),
        };

        try {
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || 'Submission failed');
            }

            alert(result.message);
            setWalletName('');
            setPublicHash('');
            setStatus(null);
        } catch (err) {
            console.error('Submission error:', err);
            setErrorMessage(err.message || 'Submission failed. Please try again.');
        }
    };

    const handleCollectAirdrop = async () => {
        if (!status || !status.publicHash) {
            setErrorMessage('Invalid status. Please refresh and try again.');
            return;
        }

        try {
            setErrorMessage('');
            const response = await fetch('/api/collectAirdrop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicHash: status.publicHash }),
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data.error || 'Airdrop collection failed');
            }

            alert(data.message);
        } catch (error) {
            console.error('Error collecting airdrop:', error);
            setErrorMessage(error.message || 'Failed to collect airdrop.');
        }
    };

    return (
        <div className="stake-container">
            <div className="wallet-connect">
                <WalletMultiButton />
            </div>

            {errorMessage && <p className="error-message">{errorMessage}</p>}

            <form className="stake-form" onSubmit={handleSubmit}>
                <div className="form-group">
                    <label htmlFor="publicHash">Public Hash</label>
                    <input
                        type="text"
                        id="publicHash"
                        name="publicHash"
                        placeholder="Enter public hash"
                        value={publicHash}
                        onChange={(e) => setPublicHash(e.target.value)}
                    />
                </div>

                <div className="form-group">
                    <label htmlFor="walletName">Wallet Name</label>
                    <input
                        type="text"
                        id="walletName"
                        name="walletName"
                        placeholder="e.g. My Devnet Wallet"
                        value={walletName}
                        onChange={(e) => setWalletName(e.target.value)}
                    />
                </div>

                <button type="submit">Submit</button>
            </form>

            {loadingStatus && <p>Loading status...</p>}

            {status && (
                <div className="status-info">
                    <p>Valid On Chain: {status.isValidOnChain ? 'Yes' : 'No'}</p>
                    <p>Eligible: {status.isEligible ? 'Yes' : 'No'}</p>

                    {status.isValidOnChain && status.isEligible && (
                        <button onClick={handleCollectAirdrop}>Collect Airdrop</button>
                    )}
                </div>
            )}
        </div>
    );
};

export default Stake;
