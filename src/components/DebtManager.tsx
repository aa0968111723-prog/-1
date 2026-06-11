import React, { useState, useMemo } from 'react';
import { Debt, Transaction, DebtType, DEBT_TYPE_LABELS } from '../types';
import { Plus, Trash2, CreditCard, Landmark, Check, Clock, AlertTriangle, FileText, PieChart as PieChartIcon } from 'lucide-react';
import { formatCurrency } from '../lib/formatters';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';

interface Props {
  debts: Debt[];
  onAdd: (debt: Omit<Debt, 'id'>) => void;
  onDelete: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Debt>) => void;
  onAddTransaction?: (transaction: Omit<Transaction, 'id'>) => void;
}

export default function DebtManager({ debts, onAdd, onDelete, onUpdate, onAddTransaction }: Props) {
  const [name, setName] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('other');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [quickRepayId, setQuickRepayId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null);
  const [editMonthlyPayment, setEditMonthlyPayment] = useState('');

  const toggleExpand = (debt: Debt) => {
    if (expandedDebtId === debt.id) {
      setExpandedDebtId(null);
    } else {
      setExpandedDebtId(debt.id);
      setEditMonthlyPayment((debt.monthlyPayment || 0).toString());
      setQuickRepayId(null);
    }
  };

  const handleUpdateMonthlyPayment = (debtId: string) => {
    if (!onUpdate) return;
    const val = Number(editMonthlyPayment);
    if (!isNaN(val) && val >= 0) {
      onUpdate(debtId, { monthlyPayment: val });
      setExpandedDebtId(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !amount) return;

    onAdd({
      name,
      type: debtType,
      amount: Number(amount),
      initialAmount: Number(amount),
      interestRate: Number(interestRate) || 0,
      monthlyPayment: Number(monthlyPayment) || 0,
      dueDate,
      note
    });

    setName('');
    setDebtType('other');
    setAmount('');
    setInterestRate('');
    setMonthlyPayment('');
    setDueDate('');
    setNote('');
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

  const chartData = useMemo(() => {
    const grouped = debts.reduce((acc, debt) => {
      const type = debt.type || 'other';
      if (debt.amount > 0) {
        acc[type] = (acc[type] || 0) + debt.amount;
      }
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped)
      .map(([type, value]) => ({
        name: DEBT_TYPE_LABELS[type as DebtType] || type,
        value,
        type
      }))
      .sort((a, b) => b.value - a.value);
  }, [debts]);

  const COLORS = ['#CD7A70', '#D1A066', '#87A2B4', '#8E7CC3', '#E6C229', '#769C7C'];

  return (
    <div className="glass p-6">
      <div className="flex items-center gap-2 mb-6 text-[#CD7A70]">
        <CreditCard />
        <h2 className="text-xl font-bold text-[#5C5248]">負債追蹤</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-5 bg-[#CD7A70]/10 border border-[#CD7A70]/20 rounded-2xl shadow-inner flex flex-col justify-center">
          <div className="text-xs text-[#CD7A70]/80 font-bold tracking-widest uppercase mb-1">當前總負債</div>
          <div className="text-3xl font-extrabold text-[#CD7A70] tracking-tighter">{formatCurrency(totalDebt)}</div>
        </div>

        {totalDebt > 0 && chartData.length > 0 && (
          <div className="bg-white/40 border border-black/5 rounded-2xl p-4 shadow-sm h-32 md:h-full min-h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  innerRadius={30}
                  outerRadius={50}
                  paddingAngle={2}
                  dataKey="value"
                  stroke="none"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip 
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '12px' }}
                />
                <Legend 
                  layout="vertical" 
                  verticalAlign="middle" 
                  align="right"
                  wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', color: '#5C5248' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 mb-8 bg-white/40 p-4 rounded-2xl border border-black/5 shadow-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">種類</label>
            <select
              value={debtType}
              onChange={(e) => setDebtType(e.target.value as DebtType)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
            >
              {(Object.keys(DEBT_TYPE_LABELS) as DebtType[]).map((type) => (
                <option key={type} value={type}>{DEBT_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">名稱</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="例如：就學貸款、中信卡費"
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
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">每月預計還款</label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyPayment}
              onChange={e => setMonthlyPayment(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="可用來推算還清期數"
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
          <div className="md:col-span-2">
            <label className="block text-[10px] font-bold text-[#82786D]/80 uppercase tracking-[0.1em] mb-1">備註 (選填)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full bg-white/60 border border-black/5 rounded-xl px-4 py-2.5 text-[#5C5248] font-bold placeholder-[#82786D]/40 focus:outline-none focus:ring-2 focus:ring-[#CD7A70]/50 transition-all shadow-sm"
              placeholder="繳款帳號等資訊..."
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
          const r = (debt.interestRate || 0) / 100 / 12;
          const P = debt.amount;
          const M = debt.monthlyPayment || 0;
          let monthsToPayoff = 0;
          let totalInterestPaid = 0;
          let isNegAmortizing = false;

          if (M > 0) {
            if (M <= P * r) {
              isNegAmortizing = true;
            } else if (r === 0) {
              monthsToPayoff = Math.ceil(P / M);
            } else {
              monthsToPayoff = Math.ceil(-Math.log(1 - P * r / M) / Math.log(1 + r));
              totalInterestPaid = Math.max(0, (monthsToPayoff * M) - P);
            }
          }

          const monthlyInterestEstimate = debt.amount * ((debt.interestRate || 0) / 100) / 12;
          const progress = debt.initialAmount ? Math.max(0, Math.min(100, ((debt.initialAmount - debt.amount) / debt.initialAmount) * 100)) : 0;
          const isPaidOff = debt.amount <= 0;

          return (
          <div key={debt.id} className="relative p-5 bg-white/40 rounded-2xl border border-black/5 group overflow-hidden shadow-sm transition-all hover:shadow-md hover:bg-white/60">
            {debt.initialAmount && debt.initialAmount > 0 ? (
              <div className="absolute top-0 left-0 w-full h-1 bg-black/5">
                <div 
                  className="h-full bg-[#CD7A70] transition-all duration-500" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}

            <div 
              className="flex items-start justify-between mb-4 cursor-pointer"
              onClick={() => toggleExpand(debt)}
            >
              <div>
                <div className="font-bold text-[#5C5248] hover:text-[#CD7A70] tracking-wide text-lg flex flex-wrap items-center gap-2 transition-colors">
                  {debt.name}
                  {debt.type && (
                     <span className="text-[10px] bg-[#EAE4DB]/50 text-[#82786D] px-2 py-0.5 rounded border border-black/5 font-bold">
                       {DEBT_TYPE_LABELS[debt.type]}
                     </span>
                  )}
                  {isPaidOff && (
                    <span className="text-[10px] bg-[#769C7C]/10 text-[#769C7C] px-2 py-0.5 rounded-full font-bold border border-[#769C7C]/20 flex items-center gap-1">
                      <Check size={12}/> 已結清
                    </span>
                  )}
                </div>
                
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs font-medium text-[#82786D]">
                  <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-[#CD7A70]" /> 利率: {debt.interestRate}%</span>
                  {debt.dueDate && <span className="flex items-center gap-1"><Clock size={12} /> 到期日: {debt.dueDate}</span>}
                  {debt.note && <span className="flex items-center gap-1 w-full mt-1 text-[#82786D]/70"><FileText size={12} /> {debt.note}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(debt.id);
                  }}
                  className="p-1.5 text-[#82786D]/20 hover:text-[#CD7A70] hover:bg-[#CD7A70]/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 lg:opacity-0"
                  title="刪除負債紀錄"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Analysis Section */}
            {!isPaidOff && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 bg-white/50 p-3 rounded-xl border border-black/5">
                <div>
                  <div className="text-[9px] font-bold text-[#82786D] uppercase tracking-widest mb-0.5">預估首月利息</div>
                  <div className="font-mono text-sm font-bold text-[#CD7A70]/80">
                    {formatCurrency(monthlyInterestEstimate)}
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-[9px] font-bold text-[#82786D] uppercase tracking-widest mb-0.5">還款計畫推測</div>
                  {!M ? (
                    <div className="text-xs font-medium text-[#82786D]/60 whitespace-pre-wrap">
                      未設定固定每月還款，無法計算。
                    </div>
                  ) : isNegAmortizing ? (
                    <div className="text-xs font-bold text-[#CD7A70] flex items-center gap-1">
                      <AlertTriangle size={14} /> 警告：每月還款額不足以抵扣利息，負債將持續增加！
                    </div>
                  ) : (
                    <div className="text-xs font-medium flex items-center flex-wrap gap-x-3 gap-y-1">
                      <span>預計 <strong className="text-[#CD7A70]">{monthsToPayoff}</strong> 個月還清</span>
                      <span className="text-[#82786D]/60">|</span>
                      <span>總共將支付約 <strong className="font-mono">{formatCurrency(totalInterestPaid)}</strong> 的利息</span>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="flex items-end justify-between mt-2">
              <div>
                <div className="text-[10px] font-bold text-[#82786D] uppercase tracking-widest mb-1">當前欠款剩餘</div>
                <div className="font-mono text-2xl font-extrabold text-[#CD7A70] leading-none">
                  {formatCurrency(debt.amount)}
                </div>
                {debt.initialAmount && debt.initialAmount !== debt.amount && (
                  <div className="text-[10px] text-[#82786D] mt-1">初始金額: {formatCurrency(debt.initialAmount)}</div>
                )}
              </div>
              
              {onAddTransaction && debt.amount > 0 && (
                quickRepayId === debt.id ? (
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-2 animate-in fade-in slide-in-from-right-2">
                    <input 
                      type="number"
                      autoFocus
                      placeholder="自訂還款金額..."
                      value={repayAmount}
                      onChange={e => setRepayAmount(e.target.value)}
                      className="w-28 px-2 py-1.5 bg-white/80 border border-[#769C7C]/30 text-[#5C5248] font-bold rounded text-sm outline-none focus:border-[#769C7C] shadow-sm"
                      max={debt.amount}
                    />
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => handleQuickRepay(debt.id, debt.amount)}
                        className="px-3 py-1.5 bg-[#769C7C] text-white hover:bg-[#769C7C]/90 rounded transition-colors text-xs font-bold"
                      >
                        確認還款
                      </button>
                      <button 
                        onClick={() => setQuickRepayId(null)}
                        className="p-1.5 bg-[#EAE4DB] text-[#82786D] hover:bg-[#D1A066]/20 hover:text-[#D1A066] rounded transition-colors text-xs font-bold"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {(debt.monthlyPayment || 0) > 0 && (
                      <button
                        onClick={() => {
                          const amountToRepay = Math.min(debt.monthlyPayment || 0, debt.amount);
                          onAddTransaction({
                            type: 'expense',
                            amount: amountToRepay,
                            category: 'Loan Repayments',
                            date: new Date().toISOString().split('T')[0],
                            note: '每月還款',
                            linkedDebtId: debt.id,
                          });
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold leading-none bg-[#769C7C] text-white hover:bg-[#769C7C]/90 rounded-lg transition-all shadow-sm"
                      >
                        <Landmark size={14} /> 繳本月還款
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setQuickRepayId(debt.id);
                        setRepayAmount(debt.amount.toString());
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold leading-none bg-white text-[#5C5248] border border-black/5 hover:bg-[#CD7A70]/10 hover:text-[#CD7A70] hover:border-[#CD7A70]/20 rounded-lg transition-all shadow-sm"
                    >
                      結清 / 自訂金額
                    </button>
                  </div>
                )
              )}
            </div>

            {/* Expanded Edit View */}
            {expandedDebtId === debt.id && (
              <div className="pt-4 mt-4 border-t border-black/5 space-y-4 animate-in fade-in slide-in-from-top-2" onClick={(e) => e.stopPropagation()}>
                <div className="space-y-3 bg-white/60 p-4 rounded-xl shadow-inner border border-black/5">
                  <div className="text-xs font-bold text-[#82786D] tracking-widest uppercase">編輯每月固定支出 (預計還款)</div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="0"
                      value={editMonthlyPayment}
                      onChange={e => setEditMonthlyPayment(e.target.value)}
                      className="flex-1 bg-white border border-black/10 rounded-lg px-4 py-2 text-sm font-bold text-[#5C5248] outline-none focus:ring-2 focus:ring-[#CD7A70]/50"
                      placeholder="設定每月預計還款金額"
                    />
                    <button
                      onClick={() => handleUpdateMonthlyPayment(debt.id)}
                      className="px-4 py-2 bg-[#CD7A70] text-white hover:bg-[#CD7A70]/90 rounded-lg transition-colors font-bold text-xs"
                    >
                      儲存變更
                    </button>
                  </div>
                  <p className="text-[10px] text-[#82786D]/80">
                    固定支出設定後，會更新還款計畫推測。若要進行繳款，請使用上方的「繳本月還款」或「結清 / 自訂金額」按鈕。
                  </p>
                </div>
              </div>
            )}
          </div>
        )})}
        {debts.length === 0 && (
          <div className="text-center text-[#82786D]/60 text-sm py-8 font-medium">無負債記錄</div>
        )}
      </div>
    </div>
  );
}
