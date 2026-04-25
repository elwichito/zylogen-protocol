"use client";

import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { base } from "wagmi/chains";
import { getDefaultConfig, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@rainbow-me/rainbowkit/styles.css";

const config = getDefaultConfig({
  appName: "Zylogen Protocol — Nova",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "9697dfd9af83db5aac112e59884411dd",
  chains: [base],
  ssr: true,
});

const queryClient = new QueryClient();

const novaTheme = darkTheme({
  accentColor: "#00e5ff",
  accentColorForeground: "#0a0a0a",
  borderRadius: "small",
  fontStack: "system",
});

// Override specific theme tokens to match Nova Intelligence aesthetic
novaTheme.colors.modalBackground = "#0d1117";
novaTheme.colors.modalBorder = "#1a2a1a";
novaTheme.colors.profileForeground = "#0d1a12";
novaTheme.colors.connectButtonBackground = "#0d1a12";
novaTheme.colors.connectButtonInnerBackground = "#0a0a0a";
novaTheme.fonts.body = "'Share Tech Mono', monospace";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={novaTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
