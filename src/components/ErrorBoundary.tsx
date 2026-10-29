import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="view-container flex items-center justify-center min-h-[50vh] p-4">
          <div className="settings-card text-center max-w-lg mx-auto p-6 bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
            <div className="inline-flex p-3 rounded-full bg-rose-500/10 text-rose-500 mb-4">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Qualcosa è andato storto</h2>
            <p className="text-sm text-slate-400 mb-4">
              Si è verificato un errore imprevisto nell'interfaccia. I tuoi dati su IndexedDB sono al sicuro.
            </p>
            {this.state.error && (
              <pre className="text-xs font-mono bg-slate-950 p-3 rounded text-rose-300 text-left overflow-auto max-h-32 mb-6 border border-slate-800">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-secondary px-4 py-2 flex items-center gap-2 text-sm"
              >
                <span>Riprova</span>
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="btn-primary px-4 py-2 flex items-center gap-2 text-sm"
              >
                <RotateCcw size={15} />
                <span>Ricarica Pagina</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
