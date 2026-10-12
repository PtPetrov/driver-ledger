import React from "react";
import { createRoot } from "react-dom/client";
import LedgerApp from "../components/ledger-app";
import "../app/globals.css";

// Local-only rendering fixture. The browser test intercepts all ledger requests.
createRoot(document.getElementById("root")!).render(<LedgerApp userEmail="layout@example.test" />);
