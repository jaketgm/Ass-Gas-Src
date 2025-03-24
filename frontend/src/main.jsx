import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import CoinContextProvider from './context/CoinContext.jsx';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';

import App from './App.jsx';

const networkEndpoint = "https://api.devnet.solana.com";
const wallets = [
	new PhantomWalletAdapter(),
	new SolflareWalletAdapter(),
];

createRoot(document.getElementById('root')).render(
	<StrictMode>
	<BrowserRouter>
		<CoinContextProvider>
		<ConnectionProvider endpoint={networkEndpoint}>
			<WalletProvider wallets={wallets} autoConnect>
			<WalletModalProvider>
				<Routes>
				<Route path="/*" element={<App />} />
				</Routes>
			</WalletModalProvider>
			</WalletProvider>
		</ConnectionProvider>
		</CoinContextProvider>
	</BrowserRouter>
	</StrictMode>,
);


/* localStorage.setItem('isAdmin', 'true'); */