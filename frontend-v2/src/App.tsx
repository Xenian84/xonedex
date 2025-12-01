import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { WalletProvider } from './lib/WalletProvider'
import Swap from './pages/Swap'
import Liquidity from './pages/Liquidity'
import Layout from './components/ui/Layout'

function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Swap />} />
            <Route path="/swap" element={<Swap />} />
            <Route path="/liquidity" element={<Liquidity />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </WalletProvider>
  )
}

export default App

