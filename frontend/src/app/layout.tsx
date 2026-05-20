import type { Metadata } from "next";
import { Rajdhani, Share_Tech_Mono } from "next/font/google";
import Providers from "./providers";

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-rajdhani",
  display: "swap",
});

const shareTechMono = Share_Tech_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-share-tech-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nova — Your founder's thinking partner | Zylogen",
  description:
    "1:1 AI consultant for solo founders on Base. Naming, copy, GTM, hard product calls — $9.99/month for the first 100 members, $29.99/mo after. Cancel anytime.",
  openGraph: {
    title: "Nova — Your founder's thinking partner",
    description:
      "Direct chat with an AI consultant trained for solo founders on Base. $9.99/mo for the founding 100, $29.99/mo after. Cancel anytime.",
    url: "https://zylogen.xyz/nova",
    siteName: "Zylogen Protocol",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nova — Your founder's thinking partner",
    description:
      "Direct chat with an AI consultant for solo founders on Base. $9.99/mo for the founding 100, $29.99/mo after.",
  },
  metadataBase: new URL("https://zylogen.xyz"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${rajdhani.variable} ${shareTechMono.variable}`}>
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { font-size: 16px; -webkit-font-smoothing: antialiased; }
          body { background: #0a0a0a; color: #c0c0c0; font-family: var(--font-rajdhani), system-ui, sans-serif; }
          a { color: inherit; text-decoration: none; }
        `}</style>
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
