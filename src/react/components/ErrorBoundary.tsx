import React from "react";
import { logCrash } from "../lib/crashLog";

type ErrorBoundaryProps = { children: React.ReactNode };
type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error("ErrorBoundary caught error:", error, info);
    logCrash("ErrorBoundary", error, {
      componentStack: (info as { componentStack?: string })?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center text-sm text-slate-600 dark:text-slate-300">
          Something went wrong. Please reload.
        </div>
      );
    }
    return this.props.children;
  }
}


