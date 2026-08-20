import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert, RefreshCw, Undo2 } from 'lucide-react';

const LOG_TAG = '[FinTracker.ErrorBoundary]';

/**
 * 「DOM 已經和 React 對不起來」的錯誤。
 *
 * 手機上最常見的來源是瀏覽器的網頁翻譯（Chrome 自動翻譯會直接改寫 React 管理的
 * 文字節點），React 下一次要移除那個節點時就會丟
 * `Failed to execute 'removeChild' on 'Node'`。
 *
 * 我們**不**去 monkey patch `Node.prototype.removeChild` 把錯誤吞掉 —— 那只是
 * 讓畫面繼續用一棵已經錯的樹跑下去。這裡只做一件事：辨識出這一類錯誤，好給使用者
 * 一句看得懂的話和一個真的有用的動作。
 */
function isDomDesyncError(error: Error): boolean {
  // removeChild / insertBefore 在節點不屬於該父層時丟的是 DOMException('NotFoundError')。
  if (error.name === 'NotFoundError') return true;
  const message = error.message ?? '';
  return (
    /Failed to execute '(removeChild|insertBefore|appendChild|replaceChild)' on 'Node'/.test(
      message,
    ) || /not a child of this node/i.test(message)
  );
}

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

  /**
   * 「回上一頁」真的回上一頁。
   *
   * 只做 `setState({error: null})` 是假的復原：使用者按下去之後還在同一個畫面，什麼也沒回到。
   * 所以這裡真的呼叫 `window.history.back()`，再把錯誤狀態清掉讓子樹重新掛載
   * （boundary 顯示 fallback 時 React 已經把子樹卸載，重新 render 會是全新的 fiber）。
   * 真的沒有上一頁可回（冷啟動、APK 首頁）時就重新載入，而不是留一顆按了沒反應的按鈕。
   */
  private handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      this.setState({ error: null });
      return;
    }
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const desync = isDomDesyncError(error);
    const title = desync ? '畫面需要重新同步' : (this.props.fallbackTitle ?? '這個畫面出了點狀況');
    const body = desync
      ? '畫面和資料對不起來了（手機瀏覽器的網頁翻譯最常造成這件事）。你的記帳資料都還好好地留在這台裝置上，沒有任何一筆被更動。'
      : '只是畫面沒能正常顯示，你的記帳資料都還好好地留在這台裝置上，沒有任何一筆被更動。';

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

        <p className="text-sm font-bold text-[#82786D] leading-relaxed mb-4">{body}</p>

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
            onClick={this.handleBack}
            className="flex-1 flex items-center justify-center gap-2 bg-white/60 hover:bg-white border border-black/5 text-[#5C5248] font-bold py-3 rounded-xl transition-all active:scale-[0.98]"
          >
            <Undo2 size={16} /> 回上一頁
          </button>
        </div>
      </div>
    );
  }
}
