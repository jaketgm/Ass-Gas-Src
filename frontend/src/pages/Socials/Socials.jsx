import React from 'react';
import './Socials.css';
import { FaTwitter, FaInstagram, FaTelegramPlane } from 'react-icons/fa';

const Socials = () => {
	return (
		<div className="socials-container">
			{/* Twitter */}
			<div className="icon-card">
				<a href="https://x.com/ASSGASTOKEN" target="_blank" rel="noopener noreferrer">
					<div className="icon">
						<FaTwitter />
					</div>
				</a>
			</div>

			{/* Instagram */}
			<div className="icon-card">
				<a href="#">
					<div className="icon">
						<FaInstagram />
					</div>
				</a>
			</div>

			{/* Telegram */}
			<div className="icon-card">
				<a href="https://t.me/+iN4Dq21tUzNmODM5" target="_blank" rel="noopener noreferrer">
					<div className="icon">
						<FaTelegramPlane />
					</div>
				</a>
			</div>
		</div>
	);
};

export default Socials;