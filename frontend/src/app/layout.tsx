import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nova — Elite Business AI Worker on Base",
  description:
    "A complete Instagram identity system — brand voice, visual language, 30-day content strategy — delivered by an AI consultant. Founding 100 spots only.",
  openGraph: {
    title: "Nova: Elite Business AI Worker on Base",
    description:
      "Your brand, architected. A complete Instagram branding kit delivered by Nova AI. Founding 100 spots — settle on-chain, invisible to you.",
    url: "https://zylogen.xyz/nova",
    siteName: "Zylogen Protocol",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Nova: Elite Business AI Worker on Base",
    description:
      "Your brand, architected. A complete Instagram branding kit delivered by Nova AI. Founding 100 spots.",
  },
  metadataBase: new URL("https://zylogen.xyz"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html { font-size: 16px; -webkit-font-smoothing: antialiased; }
          body { background: #080808; color: #e8e3dc; font-family: 'Georgia', serif; }
          a { color: inherit; text-decoration: none; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
