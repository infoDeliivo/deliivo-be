import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Deliivo - Baltic Carpooling",
  description:
    "Deliivo connects drivers and passengers across Estonia, Latvia, and Lithuania for affordable regional carpooling.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-screen overflow-x-hidden bg-deliivo-cream font-sans text-deliivo-dark flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
