import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert, RefreshCw, Undo2 } from 'lucide-react';

const LOG_TAG = '[FinTracker.ErrorBoundary]';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 只留下紀錄：畫面壞掉時絕不清除、重置或遷移任何 storage，帳本不該為了修畫面而被動到。
    console.error(LOG_TAG, error, errorInfo.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleDismiss = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const title = this.props.fallbackTitle ?? '這個畫面出了點狀況';

    return (
      <div
        role="alert"
        className="bg-[#FAF6F0] border border-black/5 rounded-[24px] p-6 shadow-sm"
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 shrink-0 bg-[#87A2B4]/15 text-[#87A2B4] flex items-center justify-center rounded-2xl">
            <TriangleAlert size={20} />
          </div>
          <h3 className="font-bold text-[#5C5248]">{title}</h3>
        </div>

        <p className="text-sm font-bold text-[#82786D] leading-relaxed mb-4">
          只是畫面沒能正常顯示，你的記帳資料都還好好地留在這台裝置上，沒有任何一筆被更動。
        </p>

        <pre className="text-xs font-mono text-[#82786D] bg-white/60 border border-black/5 rounded-xl p-3 mb-4 whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
          {error.message || String(error)}
        </pre>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={this.handleReload}
            className="flex-1 flex items-center justify-center gap-2 bg-[#87A2B4] hover:bg-[#87A2B4]/90 text-white font-bold py-3 rounded-xl transition-all shadow-sm active:scale-[0.98]"
          >
            <RefreshCw size={16} /> 重新載入
          </button>
          <button
            type="button"
            onClick={this.handleDismiss}
            className="flex-1 flex items-center justify-center gap-2 bg-white/60 hover:bg-white border border-black/5 text-[#5C5248] font-bold py-3 rounded-xl transition-all active:scale-[0.98]"
          >
            <Undo2 size={16} /> 回到上一頁
          </button>
        </div>
      </div>
    );
  }
}
