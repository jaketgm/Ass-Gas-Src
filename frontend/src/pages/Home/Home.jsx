import React, { useEffect, useRef, useState } from 'react';
import useDebounce from '../../../../backend/useDebounce.mjs';
import "./Home.css";

const TIMEFRAMES = {
	'5m':  5 * 60,
	'1h':  60 * 60,
	'6h':  6  * 60 * 60,
	'24h': 24 * 60 * 60,
	'7d':  7  * 24 * 60 * 60,
	'30d': 30 * 24 * 60 * 60,
	'90d': 90 * 24 * 60 * 60,
};

const Home = () => {
	const chartRef = useRef(null);

	const [coinData, setCoinData] = useState(null);
	const [historicalData, setHistoricalData] = useState({
		price: null,
		priceChangePercent: null,
		marketCap: null,
		marketCapChangePercent: null,
	});

	// timeframe the user is selecting (changes immediately on click)
	const [timeframe, setTimeframe] = useState("24h");

	// debounced timeframe only updates after 2 seconds of no changes
	const debouncedTimeframe = useDebounce(timeframe, 2000);

	const [scriptLoaded, setScriptLoaded] = useState(false);

	// load the TradingView script once
	useEffect(() => {
		const existingScript = document.getElementById("tradingview-script");
		if (existingScript) 
		{
			if (window.TradingView) setScriptLoaded(true);
			return;
		}
		const script = document.createElement('script');
		script.id = "tradingview-script";
		script.src = "https://s3.tradingview.com/tv.js";
		script.async = true;
		script.onload = () => setScriptLoaded(true);
		document.body.appendChild(script);
	}, []);

	// initialize chart once script is ready
	useEffect(() => {
		if (scriptLoaded && window.TradingView && chartRef.current) 
		{
			new window.TradingView.widget({
				width: "100%",
				height: 600,
				symbol: "BINANCE:SOLUSDT",
				interval: "D",
				timezone: "Etc/UTC",
				theme: "dark",
				style: "1",
				locale: "en",
				toolbar_bg: "#f1f3f6",
				enable_publishing: false,
				allow_symbol_change: true,
				container_id: "tradingview_solana",
			});
		}
	}, [scriptLoaded]);

	// fetch the live coin data on mount
	useEffect(() => {
		fetch('/api/coingecko/api/v3/coins/solana?tickers=false&market_data=true')
			.then((res) => res.json())
			.then((data) => setCoinData(data))
			.catch((err) => console.error('Error fetching live coin data:', err));
	}, []);

	// when the debounced timeframe changes, fetch historical data
	useEffect(() => {
		const fetchHistoricalData = async () => {
			try 
			{
				const seconds = TIMEFRAMES[debouncedTimeframe];
				
				const nowRaw = Math.floor(Date.now() / 1000);
				const nowRounded = Math.floor(nowRaw / 60) * 60;

				const from = nowRounded - seconds;

				const url = `/api/coingecko/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${from}&to=${nowRounded}`;
				const res = await fetch(url);
				if (!res.ok) 
				{
					console.error(`HTTP error! status: ${res.status}`);
					return;
				}
				const data = await res.json();

				if (!data.prices || data.prices.length < 2) 
				{
					setHistoricalData({
						price: null,
						priceChangePercent: null,
						marketCap: null,
						marketCapChangePercent: null,
					});
					return;
				}

				const prices = data.prices;
				const firstPrice = prices[0][1];
				const lastPrice = prices[prices.length - 1][1];
				const priceChangePercent = ((lastPrice - firstPrice) / firstPrice) * 100;

				let marketCap = null;
				let marketCapChangePercent = null;
				if (data.market_caps && data.market_caps.length >= 2) 
				{
					const firstMC = data.market_caps[0][1];
					const lastMC = data.market_caps[data.market_caps.length - 1][1];
					marketCap = lastMC;
					marketCapChangePercent = ((lastMC - firstMC) / firstMC) * 100;
				}

				setHistoricalData({
					price: lastPrice,
					priceChangePercent,
					marketCap,
					marketCapChangePercent,
				});
			} 
			catch (error) 
			{
				console.error("Error fetching historical data:", error);
			}
		};

		// only fetch if we actually have a timeframe
		if (debouncedTimeframe) 
		{
			fetchHistoricalData();
		}
	}, [debouncedTimeframe]);

	// prepare display data
	let name = '';
	let symbol = '';
	let currentPrice = '';
	let supply = '';
	let currentMarketCap = '';
	let currentPriceChange24h = '';

	if (coinData && coinData.market_data) 
	{
		name = coinData.name;
		symbol = coinData.symbol;
		supply = coinData.market_data.circulating_supply?.toLocaleString() || "N/A";
		currentPriceChange24h = coinData.market_data.price_change_percentage_24h?.toFixed(2) || null;
		currentPrice = coinData.market_data.current_price.usd?.toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}) || null;
		currentMarketCap = coinData.market_data.market_cap.usd?.toLocaleString() || null;
	}

	const displayedPrice = historicalData.price
	? historicalData.price.toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		})
	: currentPrice;

	const displayedMarketCap = historicalData.marketCap
	? historicalData.marketCap.toLocaleString()
	: currentMarketCap;

	return (
		<div className="home">
			<div className="chart-container" ref={chartRef}>
			<div id="tradingview_solana" style={{ height: '600px' }}></div>
			</div>

			<div className="coin-info">
			<div className="coin-header">
				{coinData?.image?.large && <img src={coinData.image.large} alt={name} />}
				<h2>
				{name} {symbol ? `(${symbol.toUpperCase()})` : ''}
				</h2>
			</div>

			<div className="coin-stats">
				<p>Price: ${displayedPrice || 'Loading...'}</p>
				<p>Market Cap: ${displayedMarketCap || 'Loading...'}</p>
				<p>Supply: {supply || 'Loading...'}</p>
				{historicalData.priceChangePercent != null ? (
				<p>Change: {historicalData.priceChangePercent.toFixed(2)}%</p>
				) : (
				<p>24h Change: {currentPriceChange24h ? `${currentPriceChange24h}%` : 'Loading...'}</p>
				)}
			</div>

			<div className="timeframe-bar">
				{Object.keys(TIMEFRAMES).map((label) => (
				<button key={label} onClick={() => setTimeframe(label)}>
					{label}
				</button>
				))}
			</div>
			</div>
		</div>
	);
};

export default Home;