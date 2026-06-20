/**
 * CALLING SPEC:
 * - Purpose: render the `ErrorBoundary` React UI module — a reusable React error boundary that catches render errors in its subtree and shows a fallback.
 * - Inputs: callers that import `frontend/src/components/ErrorBoundary.tsx` and pass children plus an optional fallback and resetKey.
 * - Outputs: the `ErrorBoundary` React class component.
 * - Side effects: React rendering; logs caught errors to the console.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Shown when a child throws. If a function, receives (error, reset). */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** When this value changes, a previously caught error is cleared so children re-render. */
  resetKey?: unknown;
  /** Optional side-effect callback when an error is caught. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught a render error.", error, info);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }
    const { fallback } = this.props;
    if (typeof fallback === "function") {
      return fallback(error, this.reset);
    }
    if (fallback !== undefined) {
      return fallback;
    }
    return (
      <div className="grid gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-copy-14">
        <p className="font-medium text-destructive">This section failed to render.</p>
        <p className="text-muted-foreground">{error.message}</p>
        <div>
          <Button type="button" size="sm" variant="outline" onClick={this.reset}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
