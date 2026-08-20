import React, { useState, useEffect } from 'react';
import { Transaction, CATEGORIES, TransactionType, Debt, Goal, PaymentMethod, PAYMENT_METHODS } from '../types';
import { PlusCircle, Link as LinkIcon, Wallet, CheckSquare, Square } from 'lucide-react';
import { cn } from '../lib/utils';
import { getLocalDateKey } from '../lib/datetime';
import { formatMoney, parseAmountInput } from '../lib/money';

interface TransactionFormProps {
  onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
  debts?: Debt[];
  goals?: Goal[];
}

export default function TransactionForm({ onAddTransaction, debts = [], goals = [] }: TransactionFormProps) {
  const [type, setType] = useState<TransactionType>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(CATEGORIES.expense[0]);
  // Local date key: an evening entry in UTC+8 must not be filed under tomorrow.
  const [date, setDate] = useState(getLocalDateKey());
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [linkedDebtId, setLinkedDebtId] = useState('');
  const [linkedGoalId, setLinkedGoalId] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  // Load defaults on mount
  useEffect(() => {
    try {
      const defaults = JSON.parse(localStorage.getItem('fintracker_tx_defaults') || '{}');
      if (defaults.paymentMethod) setPaymentMethod(defaults.paymentMethod);
      if (defaults.type) {
        setType(defaults.type as TransactionType);
        if (defaults.type === 'expense' && defaults.expenseCategory) {
          setCategory(defaults.expenseCategory);
        } else if (defaults.type === 'income' && defaults.incomeCategory) {
          setCategory(defaults.incomeCategory);
        } else {
          setCategory(CATEGORIES[defaults.type as TransactionType][0]);
        }
      }
    } catch (e) {
      console.error('Failed to load transaction defaults', e);
    }
  }, []);

  const isDebtCategory = category === 'Loan Repayments' || category === '負債償還';
  const isGoalCategory = category === 'Investments' || category === '投資理財';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseAmountInput(amount);
    if (parsedAmount === null) return;

    if (saveAsDefault) {
      const currentDefaults = JSON.parse(localStorage.getItem('fintracker_tx_defaults') || '{}');
      const newDefaults = {
        ...currentDefaults,
        paymentMethod,
        type,
        ...(type === 'expense' ? { expenseCategory: category } : { incomeCategory: category })
      };
      localStorage.setItem('fintracker_tx_defaults', JSON.stringify(newDefaults));
    }

    onAddTransaction({
      type,
      amount: parsedAmount,
      category,
      date,
      note,
      paymentMethod,
      ...(isDebtCategory && linkedDebtId ? { linkedDebtId } : {}),
      ...(isGoalCategory && linkedGoalId ? { linkedGoalId } : {}),
    });

    // Reset form
    setAmount('');
    setNote('');
    setLinkedDebtId('');
    setLinkedGoalId('');
  };

  const handleTypeChange = (newType: TransactionType) => {
    setType(newType);
    
    // Load category based on saved defaults or fallback type's first category
    try {
      const defaults = JSON.parse(localStorage.getItem('fintracker_tx_defaults') || '{}');
      if (newType === 'expense' && defaults.expenseCategory) {
        setCategory(defaults.expenseCategory);
      } else if (newType === 'income' && defaults.incomeCategory) {
        setCategory(defaults.incomeCategory);
      } else {
        setCategory(CATEGORIES[newType][0]);
      }
    } catch (e) {
      setCategory(CATEGORIES[newType][0]);
    }
    
    setLinkedDebtId('');
    setLinkedGoalId('');
  };

  return (
    <div className="p-2 sm:p-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Type Toggle */}
        <div className="flex bg-[#EAE4DB]/50 border border-black/5 p-1 rounded-xl shadow-inner">
          <button
            type="button"
            onClick={() => handleTypeChange('expense')}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
              type === 'expense' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/40"
            )}
          >
            支出
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('income')}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
              type === 'income' ? "bg-white text-[#5C5248] shadow-sm border border-black/5" : "text-[#82786D] hover:text-[#5C5248] hover:bg-white/40"
            )}
          >
            收入
          </button>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">金額</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D]/70 font-bold">NT$</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              min="0"
              step="any"
              className="w-full pl-11 pr-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold placeholder-[#82786D]/40 rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">分類</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none appearance-none"
            >
              {CATEGORIES[type].map(c => (
                <option key={c} value={c} className="bg-white text-[#5C5248]">{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">支付方式</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none appearance-none"
            >
              {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
                <option key={key} value={key} className="bg-white text-[#5C5248]">{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">日期</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold placeholder-[#82786D]/40 rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none [color-scheme:light]"
          />
        </div>

        {isDebtCategory && debts.length > 0 && (
          <div className="bg-[#CD7A70]/10 border border-[#CD7A70]/30 p-3 rounded-xl">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-[#CD7A70] uppercase tracking-[0.1em] mb-2">
              <LinkIcon size={12} /> 連結債務 (自動扣除餘額)
            </label>
            <select
              value={linkedDebtId}
              onChange={(e) => setLinkedDebtId(e.target.value)}
              className="w-full px-4 py-2 text-sm bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-lg focus:ring-2 focus:ring-[#CD7A70]/50 focus:border-transparent outline-none appearance-none shadow-sm"
            >
              <option value="" className="bg-white text-[#5C5248]">不連結任何債務</option>
              {debts.map(d => (
                <option key={d.id} value={d.id} className="bg-white text-[#5C5248]">{d.name} (還需還款: {formatMoney(d.amount)})</option>
              ))}
            </select>
          </div>
        )}

        {isGoalCategory && goals.length > 0 && (
          <div className="bg-[#769C7C]/10 border border-[#769C7C]/30 p-3 rounded-xl">
            <label className="flex items-center gap-1.5 text-[10px] font-bold text-[#769C7C] uppercase tracking-[0.1em] mb-2">
              <LinkIcon size={12} /> 連結儲蓄目標 (自動增加進度)
            </label>
            <select
              value={linkedGoalId}
              onChange={(e) => setLinkedGoalId(e.target.value)}
              className="w-full px-4 py-2 text-sm bg-white/60 border border-black/5 text-[#5C5248] font-bold rounded-lg focus:ring-2 focus:ring-[#769C7C]/50 focus:border-transparent outline-none appearance-none shadow-sm"
            >
              <option value="" className="bg-white text-[#5C5248]">不連結任何目標</option>
              {goals.map(g => (
                <option key={g.id} value={g.id} className="bg-white text-[#5C5248]">{g.name} (還需存入: {formatMoney(g.targetAmount - g.currentAmount)})</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-2">備註 (選填)</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="這筆錢用在哪裡？ (例如：午餐便當)"
            className="w-full px-4 py-3 bg-white/60 border border-black/5 text-[#5C5248] font-bold placeholder-[#82786D]/40 rounded-xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:border-transparent focus:bg-white transition-all outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => setSaveAsDefault(!saveAsDefault)}
          className="flex items-center gap-2 text-sm text-[#82786D] hover:text-[#5C5248] transition-colors mt-2"
        >
          {saveAsDefault ? (
            <CheckSquare size={16} className="text-[#87A2B4]" />
          ) : (
            <Square size={16} />
          )}
          <span className="font-bold">將目前的分類與支付方式設為預設模式</span>
        </button>

        <button
          type="submit"
          className={cn(
            "w-full font-bold py-3.5 rounded-xl transition-all shadow-sm active:scale-[0.98]",
            type === 'income' ? "bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90" : "bg-white text-[#5C5248] hover:bg-[#FAF6F0] border border-black/5"
          )}
        >
          {type === 'income' ? '新增一筆收入' : '新增一筆支出'}
        </button>
      </form>
    </div>
  );
}
