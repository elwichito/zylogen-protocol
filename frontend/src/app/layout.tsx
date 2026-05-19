import type { Metadata } from "next";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "Nova — Your founder's thinking partner | Zylogen",
  description:
    "1:1 AI consultant for solo founders on Base. Naming, copy, GTM, hard product calls — $9.99/month. First 100 founding members lock the price forever.",
  openGraph: {
    title: "Nova — Your founder's thinking partner",
    description:
      "Direct chat with an AI consultant trained for solo founders on Base. $9.99/month. Founding 100 lock the price forever.",
    url: "https://zylogen.xyz/nova",
    siteName: "Zylogen Protocol",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nova — Your founder's thinking partner",
    description:
      "Direct chat with an AI consultant for solo founders on Base. $9.99/month. Founding 100 lock the price forever.",
  },
  metadataBase: new URL("https://zylogen.xyz"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { font-size: 16px; -webkit-font-smoothing: antialiased; }
          body { background: #0a0a0a; color: #c0c0c0; font-family: 'Rajdhani', system-ui, sans-serif; }
          a { color: inherit; text-decoration: none; }
        `}</style>
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
