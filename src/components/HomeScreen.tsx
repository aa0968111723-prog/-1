import { useMemo } from 'react';
import { Transaction, BudgetConfig } from '../types';
import { FinanceAnalyticsEngine } from '../lib/financeAnalytics';
import { formatCurrency } from '../lib/formatters';
import { getLocalDateKey } from '../lib/datetime';
import { labelForCategoryId, categoryIdForStored, emojiForCategory } from '../lib/categoryCatalog';
import { cn } from '../lib/utils';
import PetSprite, { PetSpriteMood } from './pet/PetSprite';

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
 * 手機首頁 V2（spec §二十二～二十四）：小財住在最上面的大 Hero 裡，
 * 泡泡說今天記了幾筆，下面一顆全頁最大的「＋ 快速記帳」。
 * 財務摘要只有三張柔和卡片：今日支出 / 本月支出 / 預算進度。
 * 沒有圖表、沒有 dashboard——那些在桌機版與「更多」裡。
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

  const hour = new Date().getHours();
  const heroMood: PetSpriteMood = hour >= 23 || hour < 7 ? 'sleep' : todayCount > 0 ? 'happy' : 'idle';

  return (
    <div className="space-y-4">
      {/* Hero：小財＋泡泡（spec §二十二）。點角色進小財頁。 */}
      <div className="rounded-[28px] p-5 pb-4 bg-gradient-to-b from-[#FFF3D6] to-[#FFE9A8]/60 border border-white/70 shadow-[0_10px_36px_-12px_rgba(200,170,110,0.35)]">
        <div className="flex items-start justify-between gap-3">
          {/* 泡泡 */}
          <div className="relative mt-1 max-w-[60%]">
            <div className="rounded-[20px] rounded-br-[6px] bg-white/90 border border-white px-4 py-3 shadow-sm">
              <p className="text-xs font-bold text-[#A79C90]">{greeting}</p>
              <p className="text-sm font-extrabold text-[#5C5248] leading-relaxed">
                {todayCount === 0
                  ? `今天還沒記帳，${petName}在等你唷`
                  : <>今天已經記了 <span className="text-[#D98E32] text-base">{todayCount}</span> 筆唷 ✨</>}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenPet}
            aria-label={`打開${petName}互動頁`}
            className="shrink-0 active:scale-95 transition-transform"
          >
            <PetSprite mood={heroMood} size={112} />
          </button>
        </div>

        {/* 快速記帳：整頁最大、最好按（spec §四十一 KPI） */}
        <button
          type="button"
          onClick={onQuickAdd}
          className="mt-3 w-full min-h-[64px] rounded-[24px] bg-[#87A2B4] text-white font-extrabold text-lg shadow-[0_8px_24px_rgba(135,162,180,0.4)] active:scale-[0.98] transition-transform"
        >
          ＋ 快速記帳
        </button>
      </div>

      {/* 財務摘要：三張柔和卡片（spec §二十三） */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass rounded-[24px] p-3.5 bg-white/60">
          <p className="text-[11px] font-bold text-[#82786D] mb-1">今日支出</p>
          <p className="text-lg font-extrabold text-[#5C5248] font-mono tabular-nums break-all leading-tight">
            {formatCurrency(todayExpense)}
          </p>
        </div>
        <div className="glass rounded-[24px] p-3.5 bg-[#FFD9B8]/40">
          <p className="text-[11px] font-bold text-[#82786D] mb-1">本月支出</p>
          <p className="text-lg font-extrabold text-[#5C5248] font-mono tabular-nums break-all leading-tight">
            {formatCurrency(monthExpense)}
          </p>
        </div>
        <div className="glass rounded-[24px] p-3.5 bg-[#DDEBD9]/50">
          <p className="text-[11px] font-bold text-[#82786D] mb-1">預算</p>
          {budget ? (
            <>
              <p
                className={cn(
                  'text-lg font-extrabold font-mono tabular-nums leading-tight',
                  budget.state === 'over'
                    ? 'text-[#CD7A70]'
                    : budget.state === 'approaching'
                      ? 'text-[#D1A066]'
                      : 'text-[#7D9D81]',
                )}
              >
                {Math.round(budget.usage * 100)}%
              </p>
              <div className="mt-1.5 h-1.5 rounded-full bg-black/5 overflow-hidden">
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
            </>
          ) : (
            <p className="text-xs font-bold text-[#A79C90] leading-tight mt-1">尚未設定</p>
          )}
        </div>
      </div>

      {/* 預算細節：只在吃緊/超支時多說一句，永不責備 */}
      {budget && budget.state !== 'healthy' && (
        <div className="glass rounded-[24px] p-4 flex items-center gap-3">
          <span className="text-xl" aria-hidden>📒</span>
          <p className="text-sm font-bold text-[#5C5248]">
            「{budget.label}」{budget.state === 'over'
              ? `已超出 ${formatCurrency(Math.abs(budget.remaining))}，記下來就好～`
              : `快接近這個月的設定囉，還可以花 ${formatCurrency(budget.remaining)}`}
          </p>
        </div>
      )}

      {/* 最近交易（spec §二十四）：emoji + 名稱 + 時間 + 金額 */}
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
            還沒有紀錄，按上面的「＋ 快速記帳」開始吧
          </p>
        ) : (
          <ul className="space-y-1">
            {recent.map(tx => (
              <li key={tx.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-white/40">
                <span className="w-9 h-9 rounded-full bg-[#FFF3D6] border border-white flex items-center justify-center text-lg shrink-0" aria-hidden>
                  {emojiForCategory(tx.category)}
                </span>
                <div className="min-w-0 flex-1">
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
