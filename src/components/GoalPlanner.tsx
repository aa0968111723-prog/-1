import React, { useState } from 'react';
import { Goal, Transaction } from '../types';
import { Plus, Trash2, Target, PiggyBank, Check, Calendar, TrendingUp } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';
import { cn } from '../lib/utils';

interface Props {
  goals: Goal[];
  onAdd: (goal: Omit<Goal, 'id'>) => void;
  onDelete: (id: string) => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id'>) => void;
}

export default function GoalPlanner({ goals, onAdd, onDelete, onAddTransaction }: Props) {
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [quickSaveId, setQuickSaveId] = useState<string | null>(null);
  const [saveAmount, setSaveAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !targetAmount) return;

    onAdd({
      name,
      targetAmount: Number(targetAmount),
      currentAmount: 0,
      targetDate
    });

    setName('');
    setTargetAmount('');
    setTargetDate('');
  };

  const handleQuickSave = (goalId: string, currentAmount: number, target: number) => {
    if (!onAddTransaction || !saveAmount || isNaN(Number(saveAmount))) return;
    const amount = Number(saveAmount);
    if (amount <= 0 || amount > target - currentAmount) return;

    onAddTransaction({
      type: 'expense',
      amount,
      category: 'Investments',
      date: new Date().toISOString().split('T')[0],
      note: '快速存入',
      linkedGoalId: goalId,
    });
    setQuickSaveId(null);
    setSaveAmount('');
  };

  return (
    <div className="glass p-6">
      <div className="flex items-center gap-2 mb-6 text-[#769C7C]">
        <Target />
        <h2 className="text-xl font-bold text-[#5C5248]">長期規劃與目標</h2>
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
            const target = new Date(goal.targetDate);
            const now = new Date();
            target.setHours(0, 0, 0, 0);
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
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold text-[#5C5248] tracking-wide text-lg">{goal.name}</div>
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
                    onClick={() => onDelete(goal.id)}
                    className="p-2 text-[#82786D]/40 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 rounded-xl transition-colors"
                  >
                    <Trash2 size={16} />
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
                  
                  {onAddTransaction && !isCompleted && (
                    quickSaveId === goal.id ? (
                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 mt-2">
                        <input 
                          type="number"
                          autoFocus
                          placeholder="存入金額..."
                          value={saveAmount}
                          onChange={e => setSaveAmount(e.target.value)}
                          className="w-24 px-2 py-1 bg-white/80 border border-[#D1A066]/30 text-[#5C5248] font-bold rounded text-sm outline-none focus:border-[#D1A066] shadow-sm"
                          max={goal.targetAmount - goal.currentAmount}
                        />
                        <button 
                          onClick={() => handleQuickSave(goal.id, goal.currentAmount, goal.targetAmount)}
                          className="p-1.5 bg-[#D1A066]/20 text-[#D1A066] hover:bg-[#D1A066]/40 rounded transition-colors"
                        >
                          <Check size={16} />
                        </button>
                        <button 
                          onClick={() => setQuickSaveId(null)}
                          className="p-1.5 bg-[#EAE4DB] text-[#82786D] hover:bg-[#D1A066]/20 hover:text-[#D1A066] rounded transition-colors text-xs font-bold"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setQuickSaveId(goal.id);
                          setSaveAmount(((goal.targetAmount - goal.currentAmount) * 0.1).toFixed(0)); // Default to 10% remaining
                        }}
                        className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold leading-none bg-[#EAE4DB] text-[#5C5248] border border-[#D1A066]/20 hover:bg-[#D1A066]/10 hover:text-[#D1A066] hover:border-[#D1A066]/40 rounded-lg transition-all shadow-sm"
                      >
                        <PiggyBank size={12} /> 一鍵存入
                      </button>
                    )
                  )}
                </div>
              </div>
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
