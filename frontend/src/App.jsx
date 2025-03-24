import React from 'react'
import Navbar from './components/Navbar/Navbar'
import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home/Home'
import Coin from './pages/Coin/Coin'
import Footer from './components/Footer/Footer'
import AboutUs from "./pages/AboutUs/AboutUs"
import Socials from "./pages/Socials/Socials"
import Stake from "./pages/Stake/Stake"

const App = () => {
	return (
		<div className="app">
			<Navbar />
			<Routes>
			<Route path='/' element={<Home/>}/>
			<Route path='/coin/:coinId' element={<Coin/>}/>
			<Route path='/about-us' element={<AboutUs/>}/>
			<Route path='/socials' element={<Socials/>}/>
			<Route path='/stake' element={<Stake/>}/>
			</Routes>
			<Footer/>
		</div>
	)
}

export default App