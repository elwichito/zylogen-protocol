import { useState, useCallback } from 'react'
import { useWeb3Modal, useWeb3ModalAccount, useWeb3ModalProvider } from '@web3modal/ethers/react'
import { BrowserProvider, Contract, parseEther, isAddress, hexlify, toUtf8Bytes, zeroPadValue } from 'ethers'
import './App.css'

const CONTRACT_ADDRESS = '0x55a8461ad87B5EAD0Fcc6f4474D8FaF32c1a451f'
const BASE_CHAIN_ID = 8453

const ABI = [
  {
    inputs: [
      { internalType: 'bytes32', name: 'taskHash', type: 'bytes32' },
      { internalType: 'address', name: 'provider', type: 'address' },
    ],
    name: 'lock',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
]

function shortAddr(addr) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''
}

function toBytes32(str) {
  if (/^0x[0-9a-fA-F]{64}$/.test(str)) return str
  const encoded = toUtf8Bytes(str)
  if (encoded.length > 32) throw new Error('taskHash too long (max 32 bytes as UTF-8)')
  return zeroPadValue(hexlify(encoded), 32)
}

export default function App() {
  const { open } = useWeb3Modal()
  const { address, chainId, isConnected } = useWeb3ModalAccount()
  const { walletProvider } = useWeb3ModalProvider()

  const chainOk = isConnected && Number(chainId) === BASE_CHAIN_ID

  const [taskHash, setTaskHash] = useState('')
  const [provider, setProvider] = useState('')
  const [amount, setAmount]     = useState('')
  const [status, setStatus]     = useState(null)  // { type: 'loading'|'success'|'error', msg }

  const handleLock = useCallback(async (e) => {
    e.preventDefault()
    setStatus(null)

    if (!isConnected) {
      setStatus({ type: 'error', msg: 'Connect your wallet first.' })
      return
    }
    if (!chainOk) {
      setStatus({ type: 'error', msg: 'Switch to Base Mainnet in your wallet.' })
      return
    }
    if (!isAddress(provider)) {
      setStatus({ type: 'error', msg: 'Invalid provider address.' })
      return
    }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setStatus({ type: 'error', msg: 'Enter a valid ETH amount.' })
      return
    }
    if (!taskHash.trim()) {
      setStatus({ type: 'error', msg: 'Task hash is required.' })
      return
    }

    try {
      let hash32
      try { hash32 = toBytes32(taskHash.trim()) } catch (err) {
        setStatus({ type: 'error', msg: err.message }); return
      }

      setStatus({ type: 'loading', msg: 'Confirm the transaction in your wallet…' })
      const ethProvider = new BrowserProvider(walletProvider)
      const signer = await ethProvider.getSigner()
      const contract = new Contract(CONTRACT_ADDRESS, ABI, signer)
      const tx = await contract.lock(hash32, provider, { value: parseEther(amount) })
      setStatus({ type: 'loading', msg: 'Transaction submitted. Waiting for confirmation…' })
      const receipt = await tx.wait()
      setStatus({ type: 'success', msg: 'Task locked on-chain.', txHash: receipt.hash })
      setTaskHash('')
      setProvider('')
      setAmount('')
    } catch (err) {
      const msg = err?.reason || err?.shortMessage || err?.message || 'Transaction failed.'
      setStatus({ type: 'error', msg })
    }
  }, [isConnected, chainOk, taskHash, provider, amount, walletProvider])

  return (
    <>
      {/* NAV */}
      <nav className="nav">
        <div className="nav-inner">
          <div className="nav-logo">
            <span className="logo-mark">Z</span>
            <span className="logo-text">YLOGEN</span>
          </div>
          <div className="nav-right">
            {isConnected ? (
              <div className="wallet-badge" onClick={() => open()} style={{ cursor: 'pointer' }}>
                <span className={`chain-dot ${chainOk ? 'ok' : 'warn'}`} />
                <span className="wallet-addr">{shortAddr(address)}</span>
              </div>
            ) : (
              <button className="btn-connect" onClick={() => open()}>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      <main>
        {/* HERO */}
        <section className="hero">
          <div className="hero-grid-overlay" aria-hidden="true" />
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-content">
            <div className="hero-badge">Base Mainnet · Trustless Settlement</div>
            <h1 className="hero-heading">
              Autonomous escrow<br />
              <span className="hero-accent">for AI-native work.</span>
            </h1>
            <p className="hero-tagline">
              Trustless settlement infrastructure where AI validates, arbitrates,
              and pays — autonomously.
            </p>
            <div className="hero-actions">
              {!isConnected ? (
                <button className="btn-primary" onClick={() => open()}>
                  Connect Wallet
                </button>
              ) : (
                <a href="#create" className="btn-primary">Create a Task</a>
              )}
              <a href="#how-it-works" className="btn-ghost">How it works</a>
            </div>
            <div className="hero-contract">
              <span className="label">Contract</span>
              <code className="addr">{CONTRACT_ADDRESS}</code>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="section hiw" id="how-it-works">
          <div className="section-inner">
            <p className="section-eyebrow">Protocol</p>
            <h2 className="section-heading">How it works</h2>
            <p className="section-sub">
              Three deterministic steps. No middlemen. No discretion.
            </p>
            <div className="steps">
              <div className="step">
                <div className="step-num">01</div>
                <div className="step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </div>
                <h3>Lock</h3>
                <p>The task creator locks ETH in the escrow contract, bound to a provider address and a unique task identifier. Funds are frozen on-chain — no party can move them unilaterally.</p>
              </div>
              <div className="step-divider" aria-hidden="true" />
              <div className="step">
                <div className="step-num">02</div>
                <div className="step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <h3>Validate</h3>
                <p>The Zylogen oracle monitors task completion signals off-chain. AI agents evaluate deliverables against the original spec with no human in the loop — objective, consistent, and fast.</p>
              </div>
              <div className="step-divider" aria-hidden="true" />
              <div className="step">
                <div className="step-num">03</div>
                <div className="step-icon">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 12 20 22 4 22 4 12"/>
                    <rect x="2" y="7" width="20" height="5"/>
                    <line x1="12" y1="22" x2="12" y2="7"/>
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
                  </svg>
                </div>
                <h3>Settle</h3>
                <p>On approval, the oracle releases funds to the provider minus a 1% protocol fee. On timeout (7 days), the sender can reclaim. Settlement is atomic, transparent, and final.</p>
              </div>
            </div>
          </div>
        </section>

        {/* CREATE TASK */}
        <section className="section create" id="create">
          <div className="section-inner narrow">
            <p className="section-eyebrow">dApp</p>
            <h2 className="section-heading">Create a task</h2>
            <p className="section-sub">
              Lock ETH on Base. The oracle handles the rest.
            </p>

            {!isConnected && (
              <div className="connect-prompt">
                <p>Connect your wallet to get started.</p>
                <button className="btn-primary" onClick={() => open()}>
                  Connect Wallet
                </button>
              </div>
            )}

            {isConnected && !chainOk && (
              <div className="alert alert-warn">
                Your wallet is not on Base Mainnet. Switch networks to continue.
              </div>
            )}

            <form className="task-form" onSubmit={handleLock}>
              <div className="field">
                <label htmlFor="taskHash">Task Hash</label>
                <p className="field-hint">Unique identifier for this task — a hex bytes32 or plain text (max 32 bytes).</p>
                <input
                  id="taskHash"
                  type="text"
                  placeholder="0xabc123… or &quot;my-task-id&quot;"
                  value={taskHash}
                  onChange={e => setTaskHash(e.target.value)}
                  disabled={!isConnected || !chainOk}
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              <div className="field">
                <label htmlFor="provider">Provider Address</label>
                <p className="field-hint">The wallet that will receive payment on task completion.</p>
                <input
                  id="provider"
                  type="text"
                  placeholder="0x…"
                  value={provider}
                  onChange={e => setProvider(e.target.value)}
                  disabled={!isConnected || !chainOk}
                  autoComplete="off"
                  spellCheck="false"
                />
              </div>
              <div className="field">
                <label htmlFor="amount">Amount (ETH)</label>
                <p className="field-hint">ETH to lock in escrow. A 1% fee is taken on release.</p>
                <input
                  id="amount"
                  type="number"
                  placeholder="0.01"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={!isConnected || !chainOk}
                />
              </div>

              {status && (
                <div className={`alert alert-${status.type}`}>
                  {status.type === 'loading' && <span className="spinner" />}
                  <span>{status.msg}</span>
                  {status.txHash && (
                    <a
                      href={`https://basescan.org/tx/${status.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="tx-link"
                    >
                      View on Basescan ↗
                    </a>
                  )}
                </div>
              )}

              <button
                type="submit"
                className="btn-primary btn-submit"
                disabled={!isConnected || !chainOk || status?.type === 'loading'}
              >
                {status?.type === 'loading' ? 'Locking…' : 'Lock ETH'}
              </button>
            </form>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-logo">
            <span className="logo-mark">Z</span>
            <span className="logo-text">YLOGEN</span>
          </div>
          <p className="footer-meta">
            Deployed on{' '}
            <a href={`https://basescan.org/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">
              Base Mainnet
            </a>
            {' '}· TaskEscrow{' '}
            <code>{shortAddr(CONTRACT_ADDRESS)}</code>
          </p>
        </div>
      </footer>
    </>
  )
}
