import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWeb3Modal, defaultConfig } from '@web3modal/ethers/react'
import './index.css'
import App from './App.jsx'

const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID

const base = {
  chainId: 8453,
  name: 'Base',
  currency: 'ETH',
  explorerUrl: 'https://basescan.org',
  rpcUrl: 'https://mainnet.base.org',
}

const metadata = {
  name: 'Zylogen Protocol',
  description: 'Trustless escrow for AI-native work',
  url: 'https://zylogen.xyz',
  icons: ['https://zylogen.xyz/favicon.ico'],
}

const ethersConfig = defaultConfig({
  metadata,
  enableEIP6963: true,
  enableInjected: true,
  enableCoinbase: true,
  rpcUrl: 'https://mainnet.base.org',
  defaultChainId: 8453,
})

createWeb3Modal({
  ethersConfig,
  chains: [base],
  projectId,
  enableAnalytics: false,
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
