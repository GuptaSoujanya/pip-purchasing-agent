import type { Metadata } from "next";
import { WorkspaceShell } from "@/components/workspace-shell";
import { today } from "@/lib/db/repo";
import "./globals.css";
import "./desktop-system.css";

export const metadata: Metadata = {
  title: { default: "Pip · Purchasing", template: "%s · Purchasing" },
  description:
    "Review stock coverage, supplier updates, and purchasing decisions in one workspace.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WorkspaceShell simulatedDate={today()}>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
