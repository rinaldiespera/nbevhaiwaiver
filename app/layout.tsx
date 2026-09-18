import "./globals.css";
import type { Metadata, Viewport } from "next";
import { clsx } from "clsx";

export const metadata: Metadata = {
  title: "NBEVHAI Liability Waiver",
  description:
    "Digital liability waiver signing for NBEVHAI sports facilities.",
  applicationName: "NBEVHAI Waiver",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4ed8",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head />
      <body
        className={clsx(
          "m-0 w-full min-h-screen",
          "bg-slate-50 text-slate-900",
          "font-sans antialiased"
        )}
      >
        {children}
      </body>
    </html>
  );
}
