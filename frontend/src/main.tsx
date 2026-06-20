/**
 * CALLING SPEC:
 * - Purpose: render the `main` React UI module.
 * - Inputs: callers that import `frontend/src/main.tsx` and pass module-defined arguments or framework events.
 * - Outputs: React components and UI helpers exported by `main`.
 * - Side effects: React rendering and user event wiring.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import { App } from "./App";
import { NotificationProvider } from "./components/ui/notification-center";
import { AuthProvider } from "./features/auth";

// Geist fonts (self-hosted via Fontsource). Import before styles.css so the
// @font-face declarations are available before the stylesheet applies them.
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist/700.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/600.css";

import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </NotificationProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
