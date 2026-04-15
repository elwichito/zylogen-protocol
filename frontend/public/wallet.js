// ═══════════════════════════════════════════════════════════════════════
// ZYLOGEN WALLET — Shared Web3Modal Connection (all pages)
// ═══════════════════════════════════════════════════════════════════════
(function() {
  const PROJECT_ID = '9697dfd9af83db5aac112e59884411dd';
  const BASE_CHAIN_ID = 8453;
  const BASE_CHAIN_HEX = '0x2105';
  const RPC_URL = 'https://mainnet.base.org';

  // State
  window.zyWallet = {
    address: null,
    provider: null,
    signer: null,
    connected: false,
    onConnect: null, // callback pages can set
  };

  // ── Inject Web3Modal CSS ──
  const modalCSS = document.createElement('style');
  modalCSS.textContent = `
    .zy-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.85);z-index:100000;display:none;justify-content:center;align-items:center;backdrop-filter:blur(10px)}
    .zy-modal-overlay.active{display:flex}
    .zy-modal{background:#0d1117;border:1px solid #1a2a1a;padding:32px;max-width:420px;width:92%;position:relative;font-family:'Share Tech Mono',monospace}
    .zy-modal-close{position:absolute;top:12px;right:16px;background:none;border:none;color:#606060;font-size:24px;cursor:pointer;transition:color .3s;line-height:1}.zy-modal-close:hover{color:#00ff88}
    .zy-modal h3{font-family:'Orbitron',sans-serif;font-size:14px;color:#00ff88;letter-spacing:3px;margin-bottom:20px}
    .zy-wallet-opt{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid #1a2a1a;margin-bottom:6px;cursor:pointer;transition:all .3s;background:#0d1a12}
    .zy-wallet-opt:hover{border-color:#00ff88;background:#0f2218}
    .zy-wallet-opt-icon{font-size:22px;width:36px;text-align:center;flex-shrink:0}
    .zy-wallet-opt-name{font-size:12px;letter-spacing:2px;color:#c0c0c0}
    .zy-wallet-opt-desc{font-size:9px;color:#606060;margin-top:2px}
    .zy-wallet-opt.disabled{opacity:.4;pointer-events:none}
    .zy-qr-container{text-align:center;padding:20px 0}
    .zy-qr-container canvas{margin:0 auto;border:4px solid #00ff88}
    .zy-qr-status{font-size:10px;color:#606060;margin-top:12px;letter-spacing:1px}
    .zy-qr-uri{font-size:9px;color:#606060;word-break:break-all;margin-top:8px;padding:8px;background:#0a0a0a;border:1px solid #1a2a1a;max-height:60px;overflow:auto}
    .zy-qr-back{background:none;border:1px solid #1a2a1a;color:#606060;padding:8px 16px;font-family:'Share Tech Mono',monospace;font-size:10px;letter-spacing:2px;cursor:pointer;margin-top:12px;transition:all .3s}
    .zy-qr-back:hover{border-color:#00ff88;color:#00ff88}
    .zy-status-msg{font-size:10px;color:#00e5ff;letter-spacing:1px;margin-top:12px;text-align:center}
  `;
  document.head.appendChild(modalCSS);

  // ── Build Modal HTML ──
  const overlay = document.createElement('div');
  overlay.className = 'zy-modal-overlay';
  overlay.id = 'zyWalletModal';
  overlay.innerHTML = `
    <div class="zy-modal">
      <button class="zy-modal-close" onclick="zyCloseModal()">&times;</button>
      <div id="zyModalContent">
        <h3>CONNECT WALLET</h3>
        <div class="zy-wallet-opt" onclick="zyConnectInjected('metamask')">
          <div class="zy-wallet-opt-icon">🦊</div>
          <div>
            <div class="zy-wallet-opt-name">METAMASK</div>
            <div class="zy-wallet-opt-desc">Browser extension or mobile app</div>
          </div>
        </div>
        <div class="zy-wallet-opt" onclick="zyConnectWC()">
          <div class="zy-wallet-opt-icon">🔗</div>
          <div>
            <div class="zy-wallet-opt-name">WALLETCONNECT</div>
            <div class="zy-wallet-opt-desc">Scan QR with any mobile wallet</div>
          </div>
        </div>
        <div class="zy-wallet-opt" onclick="zyConnectInjected('coinbase')">
          <div class="zy-wallet-opt-icon">🔵</div>
          <div>
            <div class="zy-wallet-opt-name">COINBASE WALLET</div>
            <div class="zy-wallet-opt-desc">Coinbase browser or mobile</div>
          </div>
        </div>
        <div class="zy-status-msg" id="zyStatusMsg" style="display:none"></div>
      </div>
    </div>
  `;
  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) zyCloseModal(); });
  });

  // ── Modal Controls ──
  window.zyOpenModal = function() {
    document.getElementById('zyWalletModal').classList.add('active');
    // Reset to main view
    document.getElementById('zyModalContent').querySelector('h3').textContent = 'CONNECT WALLET';
    document.querySelectorAll('.zy-wallet-opt').forEach(el => el.style.display = 'flex');
    const qr = document.getElementById('zyQRContainer');
    if (qr) qr.remove();
    const msg = document.getElementById('zyStatusMsg');
    if (msg) { msg.style.display = 'none'; msg.textContent = ''; }
  };

  window.zyCloseModal = function() {
    document.getElementById('zyWalletModal').classList.remove('active');
  };

  function zyShowStatus(msg) {
    const el = document.getElementById('zyStatusMsg');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ── Show Connected State ──
  function zyShowConnected(addr) {
    window.zyWallet.address = addr;
    window.zyWallet.connected = true;
    const short = addr.slice(0,6) + '...' + addr.slice(-4);

    // Update nav buttons (works for all page layouts)
    const connectBtn = document.getElementById('connectBtn');
    const walletAddr = document.getElementById('walletAddr');
    if (connectBtn) connectBtn.style.display = 'none';
    if (walletAddr) { walletAddr.style.display = 'flex'; walletAddr.textContent = short; }

    zyCloseModal();

    // Fire callback if page set one
    if (typeof window.zyWallet.onConnect === 'function') {
      window.zyWallet.onConnect(addr);
    }
  }

  // ── Switch to Base ──
  async function zySwitchToBase() {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_HEX }] });
    } catch(e) {
      if (e.code === 4902) {
        await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: BASE_CHAIN_HEX,
          chainName: 'Base',
          nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: ['https://basescan.org']
        }]});
      }
    }
  }

  // ── Injected Wallet (MetaMask / Coinbase) ──
  window.zyConnectInjected = async function(type) {
    if (typeof window.ethereum === 'undefined') {
      if (type === 'metamask') window.open('https://metamask.io/download/', '_blank');
      else if (type === 'coinbase') window.open('https://www.coinbase.com/wallet', '_blank');
      return;
    }

    zyShowStatus('REQUESTING ACCOUNT...');
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (accounts[0]) {
        await zySwitchToBase();

        // Set up ethers if available
        if (typeof ethers !== 'undefined') {
          window.zyWallet.provider = new ethers.BrowserProvider(window.ethereum);
          window.zyWallet.signer = await window.zyWallet.provider.getSigner();
        }

        zyShowConnected(accounts[0]);
      }
    } catch(e) {
      zyShowStatus('CONNECTION REJECTED');
      console.error(e);
    }
  };

  // ── WalletConnect v2 ──
  window.zyConnectWC = async function() {
    zyShowStatus('INITIALIZING WALLETCONNECT...');

    // Hide wallet options, show QR area
    document.querySelectorAll('.zy-wallet-opt').forEach(el => el.style.display = 'none');
    document.getElementById('zyModalContent').querySelector('h3').textContent = 'SCAN QR CODE';

    // Create QR container
    let qrContainer = document.getElementById('zyQRContainer');
    if (!qrContainer) {
      qrContainer = document.createElement('div');
      qrContainer.id = 'zyQRContainer';
      qrContainer.className = 'zy-qr-container';
      document.getElementById('zyModalContent').appendChild(qrContainer);
    }

    qrContainer.innerHTML = '<div class="zy-qr-status">GENERATING QR CODE...</div>';

    try {
      // Dynamically load WalletConnect SignClient
      if (!window.WalletConnectSignClient) {
        await loadScript('https://unpkg.com/@walletconnect/sign-client@2.11.0/dist/index.umd.js');
      }
      // Load QR code library
      if (!window.QRCode) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js');
      }

      const SignClient = window.SignClient || (window.WalletConnectSignClient && window.WalletConnectSignClient.SignClient);

      if (!SignClient) {
        // Fallback: use universal link approach
        zyWCFallback(qrContainer);
        return;
      }

      const client = await SignClient.init({
        projectId: PROJECT_ID,
        metadata: {
          name: 'Zylogen Protocol',
          description: 'Trustless escrow for AI-native work',
          url: 'https://zylogen.xyz',
          icons: ['https://zylogen.xyz/favicon.ico']
        }
      });

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData'],
            chains: ['eip155:8453'],
            events: ['chainChanged', 'accountsChanged']
          }
        }
      });

      if (uri) {
        // Show QR code
        qrContainer.innerHTML = '<div id="zyQRCode"></div><div class="zy-qr-status">SCAN WITH YOUR MOBILE WALLET</div><button class="zy-qr-back" onclick="zyOpenModal()">← BACK</button>';

        new QRCode(document.getElementById('zyQRCode'), {
          text: uri,
          width: 240,
          height: 240,
          colorDark: '#00ff88',
          colorLight: '#0a0a0a',
          correctLevel: QRCode.CorrectLevel.M
        });

        // Also provide copy-able URI for mobile deep link
        const copyBtn = document.createElement('div');
        copyBtn.innerHTML = `<div style="margin-top:12px"><button class="zy-qr-back" onclick="navigator.clipboard.writeText('${uri}');this.textContent='COPIED!'">COPY LINK</button></div>`;
        qrContainer.appendChild(copyBtn);
      }

      // Wait for approval
      const session = await approval();
      const accounts = session.namespaces.eip155.accounts;
      if (accounts && accounts.length > 0) {
        // Format: eip155:8453:0xAddress
        const addr = accounts[0].split(':')[2];
        zyShowConnected(addr);
      }

    } catch(e) {
      console.error('WC error:', e);
      zyWCFallback(qrContainer);
    }
  };

  // Fallback WC approach: universal link
  function zyWCFallback(container) {
    container.innerHTML = `
      <div class="zy-qr-status" style="color:#ff6b00">WALLETCONNECT SDK LOADING FAILED</div>
      <div style="margin-top:16px">
        <div class="zy-wallet-opt" onclick="window.open('https://metamask.app.link/dapp/zylogen.xyz','_blank')">
          <div class="zy-wallet-opt-icon">🦊</div>
          <div>
            <div class="zy-wallet-opt-name">OPEN IN METAMASK</div>
            <div class="zy-wallet-opt-desc">Opens zylogen.xyz in MetaMask mobile browser</div>
          </div>
        </div>
        <div class="zy-wallet-opt" onclick="window.open('https://go.cb-w.com/dapp?cb_url=https://zylogen.xyz','_blank')">
          <div class="zy-wallet-opt-icon">🔵</div>
          <div>
            <div class="zy-wallet-opt-name">OPEN IN COINBASE</div>
            <div class="zy-wallet-opt-desc">Opens zylogen.xyz in Coinbase Wallet</div>
          </div>
        </div>
      </div>
      <button class="zy-qr-back" onclick="zyOpenModal()">← BACK</button>
    `;
  }

  // Script loader
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => resolve(); // don't block on failure
      document.head.appendChild(s);
    });
  }

  // ── Override legacy functions ──
  // Pages that call openWallet() / connectWallet() will now use the new modal
  window.openWallet = window.zyOpenModal;
  window.closeWallet = window.zyCloseModal;
  window.connectWallet = window.zyOpenModal;
  window.connectMetaMask = function() { zyConnectInjected('metamask'); };
  window.connectCoinbase = function() { zyConnectInjected('coinbase'); };
  window.connectWC = window.zyConnectWC;

})();
