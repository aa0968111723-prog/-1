import { useState, useRef, useEffect, useMemo } from 'react';
import { Transaction, TransactionType, PaymentMethod } from '../types';
import { getQuickCategories, QuickCategoryChip, CATEGORY_EMOJI } from '../lib/quickCategories';
import { listCategories } from '../lib/categoryRegistry';
import { listEnabledPaymentMethods } from '../lib/paymentMethods';
import { parseQuickEntry } from '../lib/quickParser';
import { loadJSON, STORAGE_KEYS } from '../lib/storage';
import { getLocalDateKey } from '../lib/datetime';
import { parseAmountInput } from '../lib/money';
import { cn } from '../lib/utils';
import { MessageSquareText, ChevronUp } from 'lucide-react';

interface QuickTransactionFormProps {
  transactions: Transaction[];
  fastMode: boolean;
  defaultType?: TransactionType;
  onAddTransaction: (transaction: Omit<Transaction, 'id'>) => void;
  onSaved?: () => void;
}

/**
 * 極速記帳表單：金額優先、常用分類一鍵完成。
 * 它只是簡化 UI —— 最終仍透過 onAddTransaction 走原本的
 * addTransaction / FinanceRepository 流程，不複製任何業務邏輯。
 */
export default function QuickTransactionForm({
  transactions,
  fastMode,
  defaultType = 'expense',
  onAddTransaction,
  onSaved,
}: QuickTransactionFormProps) {
  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState('');
  const [selectedChip, setSelectedChip] = useState<QuickCategoryChip | null>(null);
  const [nlText, setNlText] = useState('');
  const [nlHint, setNlHint] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [moreCategory, setMoreCategory] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => {
    const defaults = loadJSON<{ paymentMethod?: PaymentMethod }>(STORAGE_KEYS.txDefaults, {});
    return defaults.paymentMethod ?? 'cash';
  });
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 金額自動 focus：點桌寵 → 直接打數字
    const t = setTimeout(() => amountRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const chips = useMemo(() => getQuickCategories(transactions, type), [transactions, type]);
  const allCategories = useMemo(() => listCategories(type), [type]);
  const paymentOptions = useMemo(() => listEnabledPaymentMethods(), []);

  const parsedAmount = parseAmountInput(amount);
  const amountValid = parsedAmount !== null;
  // Guards a double tap on 記下來 from writing the same entry twice.
  const submittingRef = useRef(false);

  const submit = (chip: QuickCategoryChip | null, overrides?: Partial<Omit<Transaction, 'id'>>) => {
    if (submittingRef.current) return;
    const category = overrides?.category ?? chip?.category ?? moreCategory;
    const finalAmount = overrides?.amount ?? parsedAmount;
    if (!category || finalAmount === null || !Number.isFinite(finalAmount) || finalAmount <= 0) return;
    submittingRef.current = true;
    try {
      onAddTransaction({
        type: overrides?.type ?? type,
        amount: finalAmount,
        category,
        categoryId: overrides?.categoryId ?? chip?.categoryId,
        date: overrides?.date ?? getLocalDateKey(),
        note: overrides?.note ?? (note || chip?.note || ''),
        paymentMethod: (overrides?.paymentMethod as PaymentMethod) ?? paymentMethod,
        source: overrides?.source ?? 'web_quick_add',
      });
    } finally {
      submittingRef.current = false;
    }
    setAmount('');
    setNote('');
    setNlText('');
    setSelectedChip(null);
    onSaved?.();
  };

  const handleChipTap = (chip: QuickCategoryChip) => {
    if (fastMode && amountValid) {
      submit(chip);
      return;
    }
    setSelectedChip(chip);
    setMoreCategory('');
  };

  const handleNlSubmit = () => {
    const parsed = parseQuickEntry(nlText);
    if (parsed.amount === null) {
      setNlHint('沒讀到金額，請直接輸入數字');
      return;
    }
    setNlHint('');
    if (parsed.confidence === 'high' && parsed.category) {
      submit(null, {
        type: parsed.type,
        amount: parsed.amount,
        category: parsed.category,
        categoryId: parsed.categoryId ?? undefined,
        date: parsed.date,
        note: parsed.note,
        source: 'web_nl',
        ...(parsed.paymentMethod ? { paymentMethod: parsed.paymentMethod } : {}),
      });
      return;
    }
    // 分類不確定時絕不亂猜：把讀到的部分填進表單，讓使用者選分類再送出。
    setType(parsed.type);
    setAmount(String(parsed.amount));
    setNote(parsed.note);
    if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
    const chip = parsed.categoryId
      ? chips.find(c => c.categoryId === parsed.categoryId && !c.note) ?? null
      : null;
    setSelectedChip(chip);
    if (!chip) {
      setMoreCategory(parsed.categoryId ? parsed.category : '');
      if (parsed.categoryId) setShowMore(true);
      setNlHint('分類：請選擇');
    }
  };

  const canSubmit = amountValid && (selectedChip !== null || moreCategory !== '');

  return (
    <div className="p-4 space-y-4" data-testid="quick-transaction-form">
      {/* 收支切換 */}
      <div className="flex bg-[#EAE4DB]/50 border border-black/5 p-1 rounded-xl shadow-inner">
        {(['expense', 'income'] as TransactionType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setType(t);
              setSelectedChip(null);
              setMoreCategory('');
            }}
            className={cn(
              'flex-1 py-2 text-sm font-bold rounded-lg transition-all',
              type === t
                ? 'bg-white text-[#5C5248] shadow-sm border border-black/5'
                : 'text-[#82786D] hover:text-[#5C5248] hover:bg-white/40',
            )}
          >
            {t === 'expense' ? '支出' : '收入'}
          </button>
        ))}
      </div>

      {/* 金額 */}
      <div className="relative">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#82786D]/70 font-bold text-lg">NT$</span>
        <input
          ref={amountRef}
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="今天花多少？"
          min="0"
          step="any"
          aria-label="金額"
          className="w-full pl-14 pr-4 py-4 text-2xl bg-white/70 border border-black/5 text-[#5C5248] font-extrabold placeholder-[#82786D]/40 rounded-2xl focus:ring-2 focus:ring-[#87A2B4]/50 focus:bg-white transition-all outline-none"
        />
      </div>

      {/* 常用分類 */}
      <div className="grid grid-cols-3 gap-2">
        {chips.map(chip => (
          <button
            key={`${chip.category}:${chip.note ?? ''}`}
            type="button"
            onClick={() => handleChipTap(chip)}
            className={cn(
              'flex flex-col items-center gap-1 py-3 rounded-2xl border transition-all active:scale-95',
              selectedChip === chip
                ? 'bg-[#87A2B4]/15 border-[#87A2B4] shadow-sm'
                : 'bg-white/60 border-black/5 hover:bg-white',
            )}
          >
            <span className="text-2xl leading-none">{chip.emoji}</span>
            <span className="text-xs font-bold text-[#5C5248]">{chip.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowMore(v => !v)}
          className="flex flex-col items-center gap-1 py-3 rounded-2xl border bg-white/40 border-dashed border-black/10 hover:bg-white transition-all active:scale-95"
        >
          <span className="text-2xl leading-none">{showMore ? <ChevronUp size={24} /> : '＋'}</span>
          <span className="text-xs font-bold text-[#82786D]">更多</span>
        </button>
      </div>

      {/* 更多：完整分類 / 備註 / 支付方式 / 自然語言 —— 平常的流程是金額 → 分類 → 記下來，
          這些是需要時才展開的東西，不該擋在中間 */}
      {showMore && (
        <div className="space-y-3 bg-white/40 border border-black/5 rounded-2xl p-3">
          <select
            value={moreCategory}
            onChange={e => {
              setMoreCategory(e.target.value);
              setSelectedChip(null);
            }}
            aria-label="完整分類"
            className="w-full px-4 py-2.5 bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none appearance-none"
          >
            <option value="">選擇分類…</option>
            {allCategories.map(c => (
              <option key={c.id} value={c.label}>
                {c.emoji ?? CATEGORY_EMOJI[c.label] ?? ''} {c.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="備註 (選填)"
            className="w-full px-4 py-2.5 bg-white/70 border border-black/5 text-[#5C5248] font-bold placeholder-[#82786D]/40 rounded-xl outline-none"
          />
          <select
            value={paymentMethod}
            onChange={e => setPaymentMethod(e.target.value as PaymentMethod)}
            aria-label="支付方式"
            className="w-full px-4 py-2.5 bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none appearance-none"
          >
            {paymentOptions.map(pm => (
              <option key={pm.id} value={pm.id}>
                {pm.emoji} {pm.label}
              </option>
            ))}
          </select>
          {/* 自然語言：認得就直接記，認不出來不會亂猜 */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MessageSquareText size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#82786D]/60" />
            <input
              type="text"
              value={nlText}
              onChange={e => setNlText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleNlSubmit();
              }}
              placeholder="快速說：午餐120、昨天晚餐180"
              aria-label="自然語言記帳"
              className="w-full pl-9 pr-3 py-2.5 text-sm bg-white/60 border border-black/5 text-[#5C5248] font-bold placeholder-[#82786D]/40 rounded-xl outline-none focus:ring-2 focus:ring-[#87A2B4]/40"
            />
          </div>
          <button
            type="button"
            onClick={handleNlSubmit}
            disabled={!nlText.trim()}
            className="px-4 py-2.5 text-sm font-bold rounded-xl bg-[#E2D8C6] text-[#5C5248] disabled:opacity-40 active:scale-95 transition-all"
          >
            解析
          </button>
        </div>
        {nlHint && (
          <p role="status" className="text-xs font-bold text-[#C08A5A] -mt-2">
            {nlHint}
          </p>
        )}
        </div>
      )}

      {/* 記下來 */}
      <button
        type="button"
        onClick={() => submit(selectedChip)}
        disabled={!canSubmit}
        className="w-full font-extrabold py-4 rounded-2xl transition-all shadow-sm active:scale-[0.98] bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 disabled:opacity-40 disabled:cursor-not-allowed text-lg"
      >
        記下來
      </button>
      {fastMode && (
        <p className="text-center text-[11px] text-[#82786D]/80 font-bold">⚡ 快速模式：輸入金額後點分類直接記帳</p>
      )}
    </div>
  );
}
