import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppProvider } from "../AppContext";
import AppShell from "../AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MineRoster — Mining Site Leave & Roster Management" },
      {
        name: "description",
        content:
          "Leave and roster management for mining operations: travel calculation, boat schedules, and multi-role access control.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return <div className="min-h-screen bg-[var(--bg)]" />;
  }
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
