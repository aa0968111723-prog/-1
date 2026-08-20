import { useMemo } from 'react';
import { Transaction, BudgetConfig } from '../types';
import { FinanceAnalyticsEngine } from '../lib/financeAnalytics';
import { formatCurrency } from '../lib/formatters';
import { getLocalDateKey } from '../lib/datetime';
import { labelForCategoryId, categoryIdForStored } from '../lib/categoryCatalog';
import { cn } from '../lib/utils';

interface HomeScreenProps {
  transactions: Transaction[];
  budgets: Record<string, BudgetConfig>;
  petName: string;
  greeting: string;
  onQuickAdd: () => void;
  onOpenTransactions: () => void;
  onOpenPet: () => void;
}

/**
 * 手機首頁。目標只有一個：**三秒內知道今天的財務狀況**，然後一鍵記帳。
 *
 * 這裡刻意沒有圖表、沒有趨勢、沒有 AI。那些都還在（桌機首頁與「更多」裡），
 * 但每天會看的那一頁不該需要捲動才看得到今天花了多少。
 */
export default function HomeScreen({
  transactions,
  budgets,
  petName,
  greeting,
  onQuickAdd,
  onOpenTransactions,
  onOpenPet,
}: HomeScreenProps) {
  const { todayExpense, todayCount, monthExpense, budget, recent } = useMemo(() => {
    const engine = new FinanceAnalyticsEngine({ transactions, budgets });
    const day = engine.totalsFor(engine.dayRange());
    const month = engine.totalsFor(engine.monthRange());

    // 只顯示「最吃緊的那一筆預算」。把所有預算加總在同一條進度條上，會在同一個
    // 分類設了兩筆預算時把支出算兩次 —— 一個看起來很精準但其實錯的數字，
    // 比不顯示更糟。
    const budgetItems = engine.getBudgetStatus('month');
    const worst = budgetItems.length > 0 ? budgetItems[0] : null;

    const todayKey = getLocalDateKey();
    const recentTxs = [...transactions]
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .slice(0, 5);

    return {
      todayExpense: day.expense,
      todayCount: transactions.filter(t => t.date === todayKey).length,
      monthExpense: month.expense,
      budget: worst,
      recent: recentTxs,
    };
  }, [transactions, budgets]);

  return (
    <div className="space-y-4">
      {/* 小財：首頁最上面就是牠，因為牠是最快的記帳入口 */}
      <button
        type="button"
        onClick={onOpenPet}
        className="w-full glass rounded-[24px] p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
      >
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-2xl shadow-inner border border-white/60 shrink-0">
          🐣
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-[#5C5248] truncate">{greeting}</p>
          <p className="text-xs text-[#82786D] font-bold truncate">
            {todayCount === 0
              ? `${petName}在等你記第一筆`
              : `${petName}陪你記了 ${todayCount} 筆`}
          </p>
        </div>
      </button>

      {/* 記一筆：整頁最大、最好按的東西 */}
      <button
        type="button"
        onClick={onQuickAdd}
        className="w-full min-h-[64px] rounded-[24px] bg-[#87A2B4] text-white font-extrabold text-lg shadow-[0_8px_24px_rgba(135,162,180,0.4)] active:scale-[0.98] transition-transform"
      >
        ＋ 記一筆
      </button>

      {/* 今天 / 本月：兩個數字，不用捲動 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass rounded-[24px] p-4">
          <p className="text-xs font-bold text-[#82786D] mb-1">今天花了</p>
          <p className="text-2xl font-extrabold text-[#5C5248] font-mono tabular-nums break-all">
            {formatCurrency(todayExpense)}
          </p>
        </div>
        <div className="glass rounded-[24px] p-4">
          <p className="text-xs font-bold text-[#82786D] mb-1">這個月</p>
          <p className="text-2xl font-extrabold text-[#5C5248] font-mono tabular-nums break-all">
            {formatCurrency(monthExpense)}
          </p>
        </div>
      </div>

      {/* 預算：沒設就不佔位置 */}
      {budget && (
        <div className="glass rounded-[24px] p-4">
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <p className="text-sm font-extrabold text-[#5C5248] truncate">
              {budget.label} 預算
            </p>
            <p
              className={cn(
                'text-sm font-extrabold font-mono tabular-nums shrink-0',
                budget.state === 'over'
                  ? 'text-[#CD7A70]'
                  : budget.state === 'approaching'
                    ? 'text-[#D1A066]'
                    : 'text-[#7D9D81]',
              )}
            >
              {budget.state === 'over'
                ? `超支 ${formatCurrency(Math.abs(budget.remaining))}`
                : `還可以花 ${formatCurrency(budget.remaining)}`}
            </p>
          </div>
          <div className="h-2 rounded-full bg-black/5 overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                budget.state === 'over'
                  ? 'bg-[#CD7A70]'
                  : budget.state === 'approaching'
                    ? 'bg-[#D1A066]'
                    : 'bg-[#7D9D81]',
              )}
              style={{ width: `${Math.min(100, budget.usage * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 最近幾筆：確認「剛剛那筆真的記到了」 */}
      <div className="glass rounded-[24px] p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-extrabold text-[#5C5248]">最近紀錄</p>
          <button
            type="button"
            onClick={onOpenTransactions}
            className="text-xs font-bold text-[#87A2B4] min-h-[32px] px-2"
          >
            看全部
          </button>
        </div>

        {recent.length === 0 ? (
          <p className="text-sm font-bold text-[#A79C90] py-4 text-center">
            還沒有紀錄，按上面的「記一筆」開始吧
          </p>
        ) : (
          <ul className="space-y-2">
            {recent.map(tx => (
              <li key={tx.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[#5C5248] truncate">
                    {labelForCategoryId(categoryIdForStored(tx.category))}
                    {tx.note ? <span className="text-[#A79C90]"> · {tx.note}</span> : null}
                  </p>
                  <p className="text-[11px] font-bold text-[#A79C90]">{tx.date}</p>
                </div>
                <p
                  className={cn(
                    'text-sm font-extrabold font-mono tabular-nums shrink-0',
                    tx.type === 'income' ? 'text-[#7D9D81]' : 'text-[#5C5248]',
                  )}
                >
                  <span>{tx.type === 'income' ? '+' : '-'}</span>
                  <span>{formatCurrency(tx.amount)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
