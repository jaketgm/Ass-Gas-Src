import React from 'react';
import './AboutUs.css';

const AboutUs = () => {
	const rainbowDivs = Array.from({ length: 25 }, (_, i) => (
		<div key={i} className="rainbow"></div>
	));

	return (
		<div className="aboutus-wrapper">
			{rainbowDivs}
			<div className="h"></div>
			<div className="v"></div>
			<div className="content">
			<div className="text-box">
				<h1>About Ass Gas</h1>
				<p>
				Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur
				aliquet quam id dui posuere blandit. Praesent sapien massa, convallis
				a pellentesque nec, egestas non nisi. Donec sollicitudin molestie
				malesuada.
				</p>
			</div>
			</div>
		</div>
	);
};

export default AboutUs;