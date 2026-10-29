import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Screen crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-8">
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <b>This screen crashed:</b> {this.state.error.message}
            <pre className="mt-2 whitespace-pre-wrap text-xs">{this.state.error.stack}</pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded bg-red-700 px-3 py-1 text-white"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}