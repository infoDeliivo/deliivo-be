import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Deliivo - Carpool Together, Go Further",
  description:
    "Deliivo connects drivers and passengers for affordable, eco-friendly carpooling. Share rides, split costs, and travel smarter together.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-screen bg-deliivo-cream font-sans text-deliivo-dark flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
