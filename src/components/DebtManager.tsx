import React, { useState } from 'react';
import { Debt, Transaction } from '../types';
import { Plus, Trash2, CreditCard, Landmark, Check } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';

interface Props {
  debts: Debt[];
  onAdd: (debt: Omit<Debt, 'id'>) => void;
  onDelete: (id: string) => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id'>) => void;
}

export default function DebtManager({ debts, onAdd, onDelete, onAddTransaction }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [quickRepayId, setQuickRepayId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !amount) return;

    onAdd({
      name,
      amount: Number(amount),
      interestRate: Number(interestRate) || 0,
      dueDate,
      note: ''
    });

    setName('');
    setAmount('');
    setInterestRate('');
    setDueDate('');
  };

  const handleQuickRepay = (debtId: string, currentAmount: number) => {
    if (!onAddTransaction || !repayAmount || isNaN(Number(repayAmount))) return;
    const amount = Number(repayAmount);
    if (amount <= 0 || amount > currentAmount) return;

    onAddTransaction({
      type: 'expense',
      amount,
      category: 'Loan Repayments',
      date: new Date().toISOString().split('T')[0],
      note: '快速還款',
      linkedDebtId: debtId,
    });
    setQuickRepayId(null);
    setRepayAmount('');
  };

  const totalDebt = debts.reduce((sum, d) => sum + d.amount, 0);

  return (
    <div className="glass p-6">
      <div className="flex items-center gap-2 mb-6 text-[#CD7A70]">
        <CreditCard />
        <h2 className="text-xl font-bold text-[#5C5248]">負債追蹤</h2>
      </div>

      <div className="mb-6 p-5 bg-[#CD7A70]/10 border border-[#CD7A70]/20 rounded-2xl shadow-inner">
        <div className="text-xs text-[#CD7A70]/80 font-bold tracking-widest uppercase mb-1">當前總負債</div>
        <div className="text-3xl font-extrabold text-[#CD7A70] tracking-tighter">{formatCurrency(totalDebt)}</div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-white/40 p-4 rounded-2xl border border-black/5 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">名稱</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="例如：學貸、卡債"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">金額</label>
            <input
              type="number"
              required
              min="0"
              step="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">利率 (%)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={interestRate}
              onChange={e => setInterestRate(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="例如：2.5"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">到期日 (選填)</label>
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm [color-scheme:light]"
            />
          </div>
        </div>
        <button
          type="submit"
          className="w-full bg-[#CD7A70] hover:bg-[#CD7A70]/90 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm active:scale-[0.98]"
        >
          <Plus size={18} />
          新增負債紀錄
        </button>
      </form>

      <div className="space-y-4">
        {debts.map(debt => {
          const monthlyInterestEstimate = debt.amount * ((debt.interestRate || 0) / 100) / 12;

          return (
          <div key={debt.id} className="relative p-5 bg-white/40 rounded-2xl border border-black/5 group overflow-hidden shadow-sm transition-all hover:shadow-md hover:bg-white/60">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="font-bold text-[#5C5248] tracking-wide text-lg flex items-center gap-2">
                  {debt.name}
                  {monthlyInterestEstimate > 0 && (
                    <span className="text-[10px] bg-[#CD7A70]/10 text-[#CD7A70] px-2 py-0.5 rounded-full font-bold border border-[#CD7A70]/20">
                      約產生 {formatCurrency(monthlyInterestEstimate)} 利息 / 月
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#82786D] mt-1 font-medium">
                  {debt.interestRate}% 利率 {debt.dueDate && `· 到期日: ${debt.dueDate}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onDelete(debt.id)}
                  className="p-2 text-[#82786D]/40 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 rounded-xl transition-all"
                  title="刪除負債紀錄"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            
            <div className="flex items-end justify-between mt-4">
              <div className="font-mono text-xl font-bold text-[#CD7A70]">
                {formatCurrency(debt.amount)}
              </div>
              
              {onAddTransaction && debt.amount > 0 && (
                quickRepayId === debt.id ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                    <input 
                      type="number"
                      autoFocus
                      placeholder="還款金額..."
                      value={repayAmount}
                      onChange={e => setRepayAmount(e.target.value)}
                      className="w-24 px-2 py-1 bg-white/80 border border-[#769C7C]/30 text-[#5C5248] font-bold rounded text-sm outline-none focus:border-[#769C7C] shadow-sm"
                      max={debt.amount}
                    />
                    <button 
                      onClick={() => handleQuickRepay(debt.id, debt.amount)}
                      className="p-1.5 bg-[#769C7C]/20 text-[#769C7C] hover:bg-[#769C7C]/40 rounded transition-colors"
                    >
                      <Check size={16} />
                    </button>
                    <button 
                      onClick={() => setQuickRepayId(null)}
                      className="p-1.5 bg-[#EAE4DB] text-[#82786D] hover:bg-[#D1A066]/20 hover:text-[#D1A066] rounded transition-colors text-xs font-bold"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setQuickRepayId(debt.id);
                      setRepayAmount(debt.amount.toString());
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold leading-none bg-[#EAE4DB] text-[#5C5248] border border-[#D1A066]/20 hover:bg-[#D1A066]/20 hover:text-[#D1A066] hover:border-[#D1A066]/40 rounded-lg transition-all shadow-sm"
                  >
                    <Landmark size={12} /> 一鍵還款
                  </button>
                )
              )}
            </div>
          </div>
        )})}
        {debts.length === 0 && (
          <div className="text-center text-[#82786D]/60 text-sm py-8 font-medium">無負債記錄</div>
        )}
      </div>
    </div>
  );
}
