import { useState, useEffect } from 'react';

/**
 * Returns a debounced value that only updates after `delay` ms 
 * of no changes to the original `value`. GPT CODE
 */
export default function useDebounce(value, delay = 1000) 
{
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
	const timer = setTimeout(() => {
		setDebounced(value);
	}, delay);

	return () => {
		clearTimeout(timer);
	};
	}, [value, delay]);

	return debounced;
}