import React, { useState, useMemo } from 'react';
import { Transaction, Debt, Goal } from '../types';
import { paymentMethodLabel } from '../lib/paymentMethods';
import { formatCurrency, formatDate } from '../lib/formatters';
import { getLocalDateKey } from '../lib/datetime';
import { Coffee, ShoppingBag, Home, Zap, HeartPulse, MoreHorizontal, Briefcase, Gift, ArrowDownRight, Bus, BookOpen, Gamepad2, TrendingUp, Search, Filter, Landmark, Plus, Link as LinkIcon, Wallet } from 'lucide-react';
import { cn } from '../lib/utils';

interface TransactionListProps {
  transactions: Transaction[];
  onDelete: (id: string) => void;
  onOpenAdd: () => void;
  debts?: Debt[];
  goals?: Goal[];
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  '餐飲美食': Coffee,
  '交通出行': Bus,
  '休閒娛樂': Gamepad2,
  '購物消費': ShoppingBag,
  '居家生活': Home,
  '水電網費': Zap,
  '醫療保健': HeartPulse,
  '學習進修': BookOpen,
  '薪資收入': Briefcase,
  '投資理財': TrendingUp,
  'Investments': TrendingUp,
  '零星獎金': Gift,
  '其他支出': MoreHorizontal,
  '其他收入': MoreHorizontal,
  'Loan Repayments': Landmark,
};

export default function TransactionList({ transactions, onDelete, onOpenAdd, debts = [], goals = [] }: TransactionListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  // 手機上只有「全部／收入／支出」是常用的；其餘篩選展開才出現。
  const [showFilters, setShowFilters] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterMonth, setFilterMonth] = useState<string>('all');
  const [filterTag, setFilterTag] = useState<string | null>(null);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    transactions.forEach(t => months.add(t.date.substring(0, 7)));
    return Array.from(months).sort().reverse();
  }, [transactions]);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    transactions.forEach(t => {
      const matches = t.note.match(/#([^\s#]+)/g);
      if (matches) {
        matches.forEach(tag => tags.add(tag));
      }
    });
    // Create an array and sort it by frequency
    const tagFreq: Record<string, number> = {};
    transactions.forEach(t => {
      const matches = t.note.match(/#([^\s#]+)/g);
      if (matches) {
        matches.forEach(tag => tagFreq[tag] = (tagFreq[tag] || 0) + 1);
      }
    });
    return Array.from(tags).sort((a, b) => tagFreq[b] - tagFreq[a]);
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // Type filter
      if (filterType !== 'all' && t.type !== filterType) return false;
      
      // Month filter
      if (filterMonth !== 'all' && !t.date.startsWith(filterMonth)) return false;

      // Tag filter
      if (filterTag && !t.note.includes(filterTag)) return false;

      // Search filter
      if (searchTerm.trim()) {
        const lowerQuery = searchTerm.toLowerCase();
        return (
          t.category.toLowerCase().includes(lowerQuery) ||
          t.note.toLowerCase().includes(lowerQuery) ||
          t.amount.toString().includes(lowerQuery)
        );
      }
      return true;
    });
  }, [transactions, searchTerm, filterType, filterMonth, filterTag]);

  const exportToCSV = () => {
    const headers = ['日期,類型,分類,金額,備註'];
    const rows = filteredTransactions.map(t => {
      const type = t.type === 'income' ? '收入' : '支出';
      // Escape commas and quotes for CSV
      const note = `"${(t.note || '').replace(/"/g, '""')}"`;
      return `${t.date},${type},${t.category},${t.amount},${note}`;
    });
    // A Blob, not a data: URI, and never inserted into the document.
    //
    // Two separate bugs were here. First, appending to and removing from
    // document.body races React's own reconciliation and is one of the ways a
    // page ends up throwing "removeChild: the node to be removed is not a
    // child of this node" — a detached anchor clicks perfectly well in every
    // modern browser, so there is no reason to insert it at all.
    //
    // Second, encodeURI() does NOT escape '#'. A note containing a hash — 
    // "#5 便當" — made the browser treat everything after it as a fragment,
    // silently truncating the export. A Blob carries the bytes verbatim and
    // has no URL-length ceiling either, which matters on mobile.
    const csv = '\uFEFF' + headers.concat(rows).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transaction_history_${getLocalDateKey()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (transactions.length === 0) {
    return (
      <div className="glass p-10 text-center flex flex-col items-center justify-center relative shadow-sm">
        <button
          onClick={onOpenAdd}
          className="absolute top-4 right-4 bg-[#87A2B4] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#87A2B4]/90 transition-all shadow-sm"
        >
          <Plus size={16} /> 新增
        </button>
        <div className="w-16 h-16 bg-white/60 border border-black/5 rounded-full flex items-center justify-center mb-4 text-[#87A2B4]">
          <ArrowDownRight size={24} />
        </div>
        <h3 className="text-lg font-bold text-[#5C5248] mb-1">目前還沒有紀錄</h3>
        <p className="text-[#82786D]">開始記下你的第一筆開銷吧！</p>
      </div>
    );
  }

  // Group by date
  const grouped = filteredTransactions.reduce((acc, curr) => {
    if (!acc[curr.date]) acc[curr.date] = [];
    acc[curr.date].push(curr);
    return acc;
  }, {} as Record<string, Transaction[]>);

  // Keys are "YYYY-MM-DD", so lexicographic order matches chronological order.
  // Comparing strings avoids new Date(key) parsing the key as UTC midnight.
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="glass overflow-hidden shadow-sm">
      <div className="p-4 sm:p-6 border-b border-black/5 space-y-3 sm:space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h3 className="hidden sm:block text-lg font-bold text-[#5C5248] shrink-0">詳細交易紀錄</h3>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D]/60" size={16} />
              <input
                type="text"
                placeholder="搜尋分類、備註或金額..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white/60 border border-black/5 text-[#5C5248] placeholder-[#82786D]/50 text-sm rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:outline-none transition-all"
              />
            </div>
            {/* The individual add button was removed in favor of the global FAB, allowing the search bar more space. */}
          </div>
        </div>
        
        {/* 手機上只留「全部／收入／支出」；月份、標籤、CSV 收在「更多篩選」裡。
            桌機維持一整排。 */}
        <div className="flex flex-wrap items-center gap-3 sm:pt-2">
           <div className="hidden sm:flex items-center gap-2 text-[#82786D]/70 text-sm">
             <Filter size={14} /> 篩選:
           </div>
           <div className="flex bg-[#EAE4DB]/50 p-1 rounded-lg border border-black/5 shadow-inner">
              <button 
                onClick={() => setFilterType('all')} 
                className={cn("px-3 py-1 rounded-md text-xs font-bold transition-all", filterType === 'all' ? "bg-white text-[#5C5248] shadow-sm" : "text-[#82786D] hover:text-[#5C5248]")}
              >全部</button>
              <button 
                onClick={() => setFilterType('income')} 
                className={cn("px-3 py-1 rounded-md text-xs font-bold transition-all", filterType === 'income' ? "bg-[#769C7C]/20 text-[#769C7C]" : "text-[#82786D] hover:text-[#769C7C]")}
              >收入</button>
              <button 
                onClick={() => setFilterType('expense')} 
                className={cn("px-3 py-1 rounded-md text-xs font-bold transition-all", filterType === 'expense' ? "bg-[#CD7A70]/20 text-[#CD7A70]" : "text-[#82786D] hover:text-[#CD7A70]")}
              >支出</button>
           </div>

           <button
             type="button"
             onClick={() => setShowFilters(v => !v)}
             aria-expanded={showFilters}
             className="sm:hidden flex items-center gap-1.5 text-xs font-bold text-[#82786D] px-3 py-1.5 rounded-lg border border-black/5 bg-white/50"
           >
             <Filter size={14} /> 更多篩選
           </button>
        </div>

        <div className={cn('flex flex-wrap items-center gap-3', !showFilters && 'hidden sm:flex')}>
           <select 
             value={filterMonth}
             onChange={(e) => setFilterMonth(e.target.value)}
             className="bg-[#EAE4DB]/50 border border-black/5 text-[#5C5248] text-xs px-3 py-1.5 rounded-lg outline-none focus:border-[#87A2B4]/50 font-mono shadow-inner"
           >
              <option value="all">所有月份</option>
              {availableMonths.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
           </select>

           {availableTags.length > 0 && (
             <select
               value={filterTag || ''}
               onChange={(e) => setFilterTag(e.target.value || null)}
               className="bg-[#EAE4DB]/50 border border-black/5 text-[#5C5248] text-xs px-3 py-1.5 rounded-lg outline-none focus:border-[#87A2B4]/50 shadow-inner"
             >
                <option value="">所有標籤</option>
                {availableTags.map(t => (
                  <option key={t} value={t}>#{t}</option>
                ))}
             </select>
           )}
           
           <div className="flex-1" />
           <button
             onClick={exportToCSV}
             className="flex items-center gap-1.5 text-xs font-bold text-[#87A2B4] hover:text-[#5C5248] px-3 py-1.5 rounded-lg border border-[#87A2B4]/30 hover:bg-[#87A2B4]/10 transition-all bg-white/50"
           >
             儲存為 CSV
           </button>
        </div>
      </div>
      
      {filteredTransactions.length === 0 ? (
        <div className="p-10 text-center text-[#82786D]/60 font-medium">
          找不到相關紀錄
        </div>
      ) : (
        <div className="divide-y divide-black/5">
          {sortedDates.map((date) => (
          <div key={date} className="p-6">
            <h4 className="text-xs tracking-wider font-bold text-[#82786D]/60 mb-4 uppercase">{formatDate(date)}</h4>
            <div className="space-y-3">
              {grouped[date].map((tx) => {
                const Icon = CATEGORY_ICONS[tx.category] || MoreHorizontal;
                const isIncome = tx.type === 'income';
                
                const linkedDebt = tx.linkedDebtId ? debts.find(d => d.id === tx.linkedDebtId) : null;
                const linkedGoal = tx.linkedGoalId ? goals.find(g => g.id === tx.linkedGoalId) : null;

                return (
                  <div key={tx.id} className="flex items-center justify-between group p-3 bg-white/40 border border-black/5 shadow-sm rounded-2xl hover:bg-white/70 hover:shadow-md transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center bg-white shadow-sm text-[#5C5248]">
                        <Icon size={20} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <p className="text-[#5C5248] font-bold text-sm tracking-wide">{tx.category}</p>
                          {linkedDebt && (
                            <span className="flex items-center gap-1 text-[10px] font-bold bg-[#CD7A70]/10 text-[#CD7A70] px-1.5 py-0.5 rounded-md border border-[#CD7A70]/20">
                              <LinkIcon size={10} /> {linkedDebt.name}
                            </span>
                          )}
                          {linkedGoal && (
                            <span className="flex items-center gap-1 text-[10px] font-bold bg-[#769C7C]/10 text-[#769C7C] px-1.5 py-0.5 rounded-md border border-[#769C7C]/20">
                              <LinkIcon size={10} /> {linkedGoal.name}
                            </span>
                          )}
                          {tx.paymentMethod && (
                            <span className="flex items-center gap-0.5 text-[10px] font-bold bg-[#EAE4DB]/50 text-[#82786D] px-1.5 py-0.5 rounded-md border border-black/5">
                              {/* Registry, not the legacy four-key map: a row paid with 悠遊卡 or
                                  LINE Pay looked up as undefined and rendered a blank chip. */}
                              <Wallet size={10} /> {paymentMethodLabel(tx.paymentMethod)}
                            </span>
                          )}
                        </div>
                        {tx.note && (
                          <p className="text-xs text-[#82786D]">
                            {tx.note.split(/(#[^\s#]+)/g).map((part, i) => 
                              part.startsWith('#') ? (
                                <span key={i} className="text-[#87A2B4] font-bold cursor-pointer hover:underline" onClick={(e) => { e.stopPropagation(); setFilterTag(part.slice(1)); }}>
                                  {part}
                                </span>
                              ) : (
                                <span key={i}>{part}</span>
                              )
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "font-extrabold tabular-nums text-sm",
                        isIncome ? "text-[#769C7C]" : "text-[#CD7A70]"
                      )}>
                        <span>{isIncome ? '+' : '-'}</span>
                        <span>{formatCurrency(tx.amount)}</span>
                      </span>
                      <button 
                        onClick={() => onDelete(tx.id)}
                        className="opacity-0 group-hover:opacity-100 text-[#82786D]/40 hover:text-[#CD7A70] transition-all p-2 rounded-full hover:bg-[#CD7A70]/10"
                        title="Delete transaction"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
