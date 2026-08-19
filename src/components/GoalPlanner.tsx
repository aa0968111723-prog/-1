import React, { useState } from 'react';
import { Goal, Transaction, Debt, BudgetConfig } from '../types';
import { Plus, Trash2, Target, PiggyBank, Check, Calendar, TrendingUp, AlertTriangle, Lightbulb } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';
import { getLocalDateKey, parseLocalDateKey } from '../lib/datetime';
import { parseAmountInput } from '../lib/money';
import { cn } from '../lib/utils';
import { useMemo } from 'react';

interface Props {
  goals: Goal[];
  debts?: Debt[];
  transactions?: Transaction[];
  monthlyIncome?: number;
  budgets?: Record<string, BudgetConfig>;
  onAdd: (goal: Omit<Goal, 'id'>) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Goal>) => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id'>) => void;
}

export default function GoalPlanner({ goals, onAdd, onDelete, onUpdate, onAddTransaction, debts = [], transactions = [], monthlyIncome = 0, budgets = {} }: Props) {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);
  
  // Variables for inline editing inside expanded view
  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionNote, setTransactionNote] = useState('');

  // 評估計算器
  const evaluation = useMemo(() => {
    // 1. 估算月收入
    let estimatedIncome = monthlyIncome;
    if (estimatedIncome <= 0 && transactions.length > 0) {
      const monthsSet = new Set<string>();
      let totalInc = 0;
      transactions.forEach(t => {
        const monthKey = t.date.substring(0, 7);
        monthsSet.add(monthKey);
        if (t.type === 'income') totalInc += t.amount;
      });
      const monthCount = Math.max(1, monthsSet.size);
      estimatedIncome = Math.round(totalInc / monthCount);
    }

    // 2. 估算生活開銷 (使用預算或平均支出)
    let estimatedExpense = 0;
    const totalBudget = Object.values(budgets).reduce((sum, b) => sum + b.amount, 0);
    if (totalBudget > 0) {
      estimatedExpense = totalBudget;
    } else if (transactions.length > 0) {
      const monthsSet = new Set<string>();
      let totalExp = 0;
      transactions.forEach(t => {
        const monthKey = t.date.substring(0, 7);
        monthsSet.add(monthKey);
        if (t.type === 'expense') totalExp += t.amount;
      });
      const monthCount = Math.max(1, monthsSet.size);
      estimatedExpense = Math.round(totalExp / monthCount);
    }

    // 3. 債務每月應繳 (本金+初步利息推算或手動設定的月還款額)
    const monthlyDebtPayment = debts.reduce((sum, d) => {
       if (d.amount <= 0) return sum;
       if (d.monthlyPayment && d.monthlyPayment > 0) return sum + d.monthlyPayment;
       // 沒設定每期應繳時，抓至少還利息
       const r = (d.interestRate || 0) / 100 / 12;
       return sum + (d.amount * r);
    }, 0);

    // 4. 各目標每月必須存入總和
    let totalRequiredSavings = 0;
    goals.forEach(goal => {
      const isCompleted = goal.currentAmount >= goal.targetAmount;
      if (goal.targetDate && !isCompleted) {
        // targetDate is a YYYY-MM-DD key: new Date(key) parses it as UTC
        // midnight, which is the previous local day in negative offsets.
        const target = parseLocalDateKey(goal.targetDate);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const diffTime = target.getTime() - now.getTime();
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          const monthsLeft = daysLeft / 30.44;
          const remainingAmount = Math.max(0, goal.targetAmount - goal.currentAmount);
          totalRequiredSavings += remainingAmount / Math.max(1, monthsLeft);
        }
      }
    });

    const netCashFlow = estimatedIncome - estimatedExpense - monthlyDebtPayment;
    const surplus = netCashFlow - totalRequiredSavings;

    return {
      estimatedIncome,
      estimatedExpense,
      monthlyDebtPayment,
      totalRequiredSavings,
      netCashFlow,
      surplus
    };
  }, [debts, transactions, monthlyIncome, budgets, goals]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !targetAmount) return;

    const parsedTarget = parseAmountInput(targetAmount);
    if (parsedTarget === null) return;

    onAdd({
      name,
      targetAmount: parsedTarget,
      currentAmount: 0,
      targetDate
    });

    setName('');
    setTargetAmount('');
    setTargetDate('');
  };

  const handleTransaction = (goalId: string, currentAmount: number, isDeposit: boolean) => {
    if (!onUpdate) return;
    const amount = parseAmountInput(transactionAmount);
    if (amount === null) return;

    let newAmount = currentAmount;
    if (isDeposit) {
      newAmount += amount;
    } else {
      newAmount -= amount;
      if (newAmount < 0) newAmount = 0;
    }

    onUpdate(goalId, { currentAmount: newAmount });
    
    // Optional: Log it in transactions if needed
    if (onAddTransaction) {
      onAddTransaction({
        type: isDeposit ? 'expense' : 'income', // Expense from wallet to goal, Income from goal back to wallet
        amount,
        category: 'Investments',
        // local date key: a UTC key files an evening entry under tomorrow
        date: getLocalDateKey(),
        note: transactionNote || (isDeposit ? '存入目標' : '目標提領'),
        linkedGoalId: goalId,
      });
    }

    setTransactionAmount('');
    setTransactionNote('');
  };

  const handleUpdateGoalInfo = (goalId: string, currentAmount: number) => {
    const targetAmt = parseAmountInput(editAmount);
    if (targetAmt === null || targetAmt < currentAmount) return; // Prevent setting target lower than current
    
    onUpdate(goalId, {
      targetAmount: targetAmt,
      targetDate: editDate || undefined
    });
    
    setExpandedGoalId(null);
  };

  const toggleExpand = (goal: Goal) => {
    if (expandedGoalId === goal.id) {
      setExpandedGoalId(null);
    } else {
      setExpandedGoalId(goal.id);
      setEditAmount(goal.targetAmount.toString());
      setEditDate(goal.targetDate || '');
      setTransactionAmount('');
      setTransactionNote('');
    }
  };

  return (
    <div className="glass p-6">
      <div className="flex items-center gap-2 mb-6 text-[#769C7C]">
        <Target />
        <h2 className="text-xl font-bold text-[#5C5248]">長期規劃與目標</h2>
      </div>

      <div className={cn("mb-8 p-4 rounded-2xl shadow-inner border", evaluation.surplus >= 0 ? "bg-[#769C7C]/10 border-[#769C7C]/20" : "bg-[#CD7A70]/10 border-[#CD7A70]/20")}>
        <div className="flex items-start gap-3">
          {evaluation.surplus >= 0 ? (
            <Lightbulb className="text-[#769C7C] shrink-0" size={20} />
          ) : (
            <AlertTriangle className="text-[#CD7A70] shrink-0" size={20} />
          )}
          <div className="flex-1">
            <h3 className={cn("text-sm font-bold mb-1", evaluation.surplus >= 0 ? "text-[#769C7C]" : "text-[#CD7A70]")}>
              {evaluation.surplus >= 0 ? '目前的收支狀況，有餘裕達成所設的各項目標' : '警告：依目前的現金流，各目標設定可能過於樂觀'}
            </h3>
            <p className="text-xs font-medium text-[#82786D] leading-relaxed mb-3">
              結合預估月收 <strong className="text-[#5C5248]">{formatCurrency(evaluation.estimatedIncome)}</strong> 與日常支出 <strong className="text-[#5C5248]">{formatCurrency(evaluation.estimatedExpense)}</strong> 共餘 <strong>{formatCurrency(evaluation.estimatedIncome - evaluation.estimatedExpense)}</strong>。<br/>扣除最低負債每月還款額 <strong className="text-[#CD7A70]">{formatCurrency(evaluation.monthlyDebtPayment)}</strong> 後，每月約有 <strong className="text-[#5C5248]">{formatCurrency(evaluation.netCashFlow)}</strong> 的可支配現金。
            </p>
            <div className="grid grid-cols-2 gap-3 p-3 bg-white/50 rounded-xl border border-black/5">
              <div>
                <div className="text-[10px] text-[#82786D] font-bold uppercase tracking-widest mb-1">所有目標每月需存入</div>
                <div className="font-mono text-sm font-bold text-[#5C5248]">{formatCurrency(evaluation.totalRequiredSavings)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#82786D] font-bold uppercase tracking-widest mb-1">評估每月結餘裕度</div>
                <div className={cn("font-mono text-sm font-extrabold", evaluation.surplus >= 0 ? "text-[#769C7C]" : "text-[#CD7A70]")}>
                  {evaluation.surplus >= 0 ? '+' : ''}{formatCurrency(evaluation.surplus)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-white/40 p-4 rounded-2xl border border-black/5 shadow-sm">
        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">目標名稱</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#769C7C]/50 transition-all shadow-sm"
              placeholder="例如：買車、歐洲旅遊"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">目標金額</label>
              <input
                type="number"
                required
                min="0"
                step="1"
                value={targetAmount}
                onChange={e => setTargetAmount(e.target.value)}
                className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#769C7C]/50 transition-all shadow-sm"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">達成期限 (選填)</label>
              <input
                type="date"
                value={targetDate}
                onChange={e => setTargetDate(e.target.value)}
                className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold focus:outline-none focus:ring-2 focus:ring-[#769C7C]/50 transition-all shadow-sm [color-scheme:light]"
              />
            </div>
          </div>
        </div>
        <button
          type="submit"
          className="w-full bg-[#769C7C] hover:bg-[#769C7C]/90 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.98]"
        >
          <Plus size={18} />
          設定新目標
        </button>
      </form>

      <div className="space-y-4">
        {goals.map(goal => {
          const progress = goal.targetAmount > 0 
            ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
            : 0;
          const isCompleted = goal.currentAmount >= goal.targetAmount;
          const remainingAmount = Math.max(0, goal.targetAmount - goal.currentAmount);

          let daysLeft = 0;
          let monthsLeft = 0;
          let suggestedMonthly = 0;

          if (goal.targetDate && !isCompleted) {
            // parse the YYYY-MM-DD key as local midnight, so the day count is
            // not off by one in negative-offset timezones
            const target = parseLocalDateKey(goal.targetDate);
            const now = new Date();
            now.setHours(0, 0, 0, 0);

            const diffTime = target.getTime() - now.getTime();
            daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (daysLeft > 0) {
              monthsLeft = daysLeft / 30.44;
              suggestedMonthly = remainingAmount / Math.max(1, monthsLeft);
            }
          }

          return (
            <div key={goal.id} className="relative p-5 bg-white/40 rounded-2xl border border-black/5 space-y-4 group overflow-hidden shadow-sm hover:shadow-md transition-all hover:bg-white/60">
              <div 
                className="flex items-start justify-between cursor-pointer"
                onClick={() => toggleExpand(goal)}
              >
                <div>
                  <div className="font-bold text-[#5C5248] tracking-wide text-lg hover:text-[#769C7C] transition-colors">{goal.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {goal.targetDate ? (
                      <span className={cn("text-xs flex items-center gap-1 font-bold px-2 py-0.5 rounded-md border", 
                        isCompleted ? "bg-[#769C7C]/10 text-[#769C7C] border-[#769C7C]/20" :
                        daysLeft < 0 ? "bg-[#CD7A70]/10 text-[#CD7A70] border-[#CD7A70]/20" :
                        daysLeft <= 30 ? "bg-[#D1A066]/10 text-[#D1A066] border-[#D1A066]/20" : 
                        "bg-[#EAE4DB] text-[#82786D] border-black/5"
                      )}>
                        <Calendar size={12} />
                        {isCompleted ? "已完成" : 
                         daysLeft < 0 ? `已逾期 ${Math.abs(daysLeft)} 天` :
                         daysLeft === 0 ? "今天到期" :
                         `剩餘 ${daysLeft} 天 (${goal.targetDate})`}
                      </span>
                    ) : (
                      <span className="text-xs text-[#82786D]/60 bg-[#EAE4DB]/50 px-2 py-0.5 rounded-md font-bold">無設定期限</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(goal.id);
                    }}
                    className="p-1.5 text-[#82786D]/20 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                    title="刪除目標"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-white/60 rounded-xl border border-black/5 shadow-inner">
                <div>
                  <div className="text-[10px] text-[#82786D] uppercase tracking-wider mb-1 font-bold">目標餘額 (差額)</div>
                  <div className="font-mono text-sm font-extrabold text-[#5C5248]">{formatCurrency(remainingAmount)}</div>
                </div>
                {goal.targetDate && !isCompleted && daysLeft > 0 && (
                  <div>
                    <div className="text-[10px] text-[#A08BA6] uppercase tracking-wider mb-1 flex items-center gap-1 font-bold">
                      <TrendingUp size={10} /> 每月建議存入
                    </div>
                    <div className="font-mono text-sm font-extrabold text-[#A08BA6]">{formatCurrency(suggestedMonthly)}<span className="text-[10px] text-[#A08BA6]/60">/月</span></div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between items-end">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-[#82786D] uppercase tracking-wider font-bold">目前已存</span>
                    <span className="text-[#5C5248] font-mono font-extrabold">{formatCurrency(goal.currentAmount)}</span>
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10px] text-[#82786D] uppercase tracking-wider font-bold">目標總額</span>
                    <span className="text-[#82786D] font-mono font-bold">{formatCurrency(goal.targetAmount)}</span>
                  </div>
                </div>
                <div className="h-2.5 w-full bg-[#EAE4DB] rounded-full overflow-hidden border border-black/5 shadow-inner">
                  <div 
                    className={cn("h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden", isCompleted ? "bg-[#769C7C]" : "bg-gradient-to-r from-[#BAAC92] to-[#D1A066]")}
                    style={{ width: `${progress}%` }}
                  >
                    {!isCompleted && progress > 0 && (
                      <div className="absolute inset-0 bg-white/30 w-1/2 -skew-x-12 animate-[shimmer_2s_infinite] -translate-x-full" />
                    )}
                  </div>
                </div>
                <div className="flex justify-between items-center mt-3">
                  <div className={cn("text-xs font-bold", isCompleted ? "text-[#769C7C] tracking-wide" : "text-[#D1A066]")}>
                    {isCompleted ? "🎉 恭喜達成目標！" : `整體進度 ${progress}%`}
                  </div>
                </div>
              </div>

              {/* Expanded Edit View */}
              {expandedGoalId === goal.id && (
                <div className="pt-4 mt-4 border-t border-black/5 space-y-5 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-[#82786D] tracking-widest uppercase">編輯目標資訊</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] text-[#82786D]/80 mb-1">目標總額</label>
                        <input
                          type="number"
                          value={editAmount}
                          onChange={e => setEditAmount(e.target.value)}
                          className="w-full bg-white/60 border border-black/5 rounded-lg px-3 py-1.5 text-sm font-bold text-[#5C5248] outline-none focus:ring-1 focus:ring-[#769C7C]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-[#82786D]/80 mb-1">目標日期</label>
                        <input
                          type="date"
                          value={editDate}
                          onChange={e => setEditDate(e.target.value)}
                          className="w-full bg-white/60 border border-black/5 rounded-lg px-3 py-1.5 text-sm font-bold text-[#5C5248] outline-none focus:ring-1 focus:ring-[#769C7C] [color-scheme:light]"
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => handleUpdateGoalInfo(goal.id, goal.currentAmount)}
                      className="w-full py-1.5 bg-[#769C7C]/10 text-[#769C7C] font-bold text-xs rounded-lg hover:bg-[#769C7C]/20 transition-colors"
                    >
                      儲存變更
                    </button>
                  </div>

                  {onAddTransaction && (
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-[#82786D] tracking-widest uppercase">存入 / 提領紀錄</div>
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="number"
                            placeholder="輸入金額..."
                            value={transactionAmount}
                            onChange={e => setTransactionAmount(e.target.value)}
                            className="bg-white/60 border border-black/5 rounded-lg px-3 py-1.5 text-sm font-bold text-[#5C5248] outline-none focus:ring-1 focus:ring-[#D1A066]"
                          />
                          <input
                            type="text"
                            placeholder="備註 (選填)"
                            value={transactionNote}
                            onChange={e => setTransactionNote(e.target.value)}
                            className="bg-white/60 border border-black/5 rounded-lg px-3 py-1.5 text-sm font-bold text-[#5C5248] outline-none focus:ring-1 focus:ring-[#D1A066]"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTransaction(goal.id, goal.currentAmount, false)}
                            className="flex-1 py-1.5 bg-[#CD7A70]/10 text-[#CD7A70] font-bold text-xs rounded-lg hover:bg-[#CD7A70]/20 transition-colors"
                          >
                            提領
                          </button>
                          <button
                            onClick={() => handleTransaction(goal.id, goal.currentAmount, true)}
                            className="flex-1 py-1.5 bg-[#D1A066]/10 text-[#D1A066] font-bold text-xs rounded-lg hover:bg-[#D1A066]/20 transition-colors"
                          >
                            存入
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {goals.length === 0 && (
          <div className="text-center text-[#82786D]/40 font-bold text-sm py-8">目前沒有設定長期目標</div>
        )}
      </div>
    </div>
  );
}
