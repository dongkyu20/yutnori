import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
export const metadata: Metadata = { title: "\uD55C\uD310\uC737", description: "\uCE5C\uAD6C\uB4E4\uACFC \uC2E4\uC2DC\uAC04\uC73C\uB85C \uC990\uAE30\uB294 \uC628\uB77C\uC778 \uC737\uB180\uC774" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
