import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Class Test Portal",
  description: "Aptitude and programming assessments for students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
