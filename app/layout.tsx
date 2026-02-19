import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Film Tree",
  description: "Visualize movie connections through cast and crew with TMDB data."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
