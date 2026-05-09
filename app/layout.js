import { Inter } from "next/font/google";
import Navbar from "@/components/Navbar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
});

export const metadata = {
  title: "Transkript Oynatıcı",
  description: "Transkript senkronizasyonlu ses oynatıcı",
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr" className={`${inter.variable} h-full antialiased`}>
      <body className="h-screen flex flex-col bg-[#1a1a1a] text-gray-200 font-sans">
        <Navbar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </body>
    </html>
  );
}
