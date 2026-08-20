import { useState, useEffect, useRef } from 'react';
import {
  PetSettings as PetSettingsType,
  PetSize,
  PetEdge,
  PetAutoCollapse,
  PetAnimationLevel,
  PetOpacity,
  PetBubbleDisplay,
  bubbleShowsAmounts,
} from '../lib/petSettings';
import { FinancePet, isNativePetAvailable, PetStatus, PetDebugInfo } from '../lib/petBridge';
import { createBackup, validateBackup, applyBackup, FinanceBackup, BackupValidation } from '../lib/backup';
import {
  listCategories,
  loadCustomCategories,
  addCustomCategory,
  removeCustomCategory,
  CustomCategory,
} from '../lib/categoryRegistry';
import {
  ALL_PAYMENT_METHODS,
  loadPaymentPrefs,
  togglePaymentMethod,
  movePaymentMethod,
  paymentMethodLabel,
  PaymentMethodPrefs,
} from '../lib/paymentMethods';
import { loadPinnedCategoryIds } from '../lib/quickCategories';
import { runIntegrityCheck, loadIntegrityReport, IntegrityReport } from '../lib/integrity';
import { STORAGE_KEYS, saveJSON } from '../lib/storage';
import { cn } from '../lib/utils';
import { runtimeEnvironment } from '../lib/runtimeEnvironment';
import AndroidDownloadCard from './AndroidDownloadCard';
import AccountPanel from './AccountPanel';

interface PetSettingsProps {
  settings: PetSettingsType;
  onChange: (settings: PetSettingsType) => void;
}

function OptionRow<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onSelect: (v: T) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-black/5 last:border-b-0">
      <span className="text-sm font-bold text-[#5C5248] shrink-0">{label}</span>
      <div className="flex bg-[#EAE4DB]/50 p-1 rounded-xl border border-black/5">
        {options.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
            className={cn(
              'px-3 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap',
              value === opt.value ? 'bg-white text-[#5C5248] shadow-sm' : 'text-[#82786D] hover:text-[#5C5248]',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass rounded-[24px] p-6">
      <h3 className="font-extrabold text-[#5C5248] mb-2">{title}</h3>
      {children}
    </div>
  );
}

export default function PetSettings({ settings, onChange }: PetSettingsProps) {
  const native = isNativePetAvailable();
  const [status, setStatus] = useState<PetStatus | null>(null);
  const [debugInfo, setDebugInfo] = useState<PetDebugInfo | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // 進階設定預設收起：每天會用到的只有前面那幾個開關。
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pinned, setPinned] = useState<string[]>(() => loadPinnedCategoryIds());
  const [customCategories, setCustomCategories] = useState<CustomCategory[]>(() => loadCustomCategories());
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [newCategoryEmoji, setNewCategoryEmoji] = useState('🏷️');
  const [newCategoryType, setNewCategoryType] = useState<'expense' | 'income'>('expense');
  const [categoryError, setCategoryError] = useState('');
  const [paymentPrefs, setPaymentPrefs] = useState<PaymentMethodPrefs>(() => loadPaymentPrefs());
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(() => loadIntegrityReport());
  const storageVersion = localStorage.getItem(STORAGE_KEYS.storageVersion) ?? '0';
  const expenseCategories = listCategories('expense');
  const [importPreview, setImportPreview] = useState<{ backup: FinanceBackup; validation: BackupValidation } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshStatus = async () => {
    try {
      setStatus(await FinancePet.getPetStatus());
      setDebugInfo(await FinancePet.getDebugInfo());
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    if (native) refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  const update = (patch: Partial<PetSettingsType>) => {
    const next = { ...settings, ...patch };
    onChange(next);
    if (native) FinancePet.setPetSettings({ settings: next }).catch(() => {});
  };

  const togglePinned = (id: string) => {
    const next = pinned.includes(id) ? pinned.filter(p => p !== id) : [...pinned, id].slice(0, 4);
    setPinned(next);
    saveJSON(STORAGE_KEYS.pinnedCategories, next);
  };

  const startPetFlow = async () => {
    setBusy(true);
    setError('');
    try {
      let { granted } = await FinancePet.canDrawOverlays();
      if (!granted) {
        ({ granted } = await FinancePet.requestOverlayPermission());
      }
      if (!granted) {
        setError('尚未取得懸浮視窗權限。FinTracker 本體仍可正常使用，隨時可以再試一次。');
        return;
      }
      const nextSettings = { ...settings, enabled: true };
      const result = await FinancePet.startPet({ settings: nextSettings });
      if (result.started) {
        onChange(nextSettings);
        setOnboardingStep(3); // 成功 → 教學步驟
      } else {
        setError(`桌寵啟動失敗（${result.reason ?? '未知原因'}），請再試一次。`);
      }
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  const stopPetFlow = async () => {
    setBusy(true);
    try {
      await FinancePet.stopPet();
      onChange({ ...settings, enabled: false });
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  // ---- backup / restore ----

  const exportData = () => {
    const backup = createBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fintracker-backup-${backup.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    setImportError('');
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const validation = validateBackup(data);
      if (!validation.ok) {
        setImportError(`備份檔驗證失敗：${validation.errors.join('、')}`);
        return;
      }
      setImportPreview({ backup: data as FinanceBackup, validation });
    } catch {
      setImportError('無法讀取檔案：不是有效的 JSON');
    }
  };

  const doImport = (mode: 'merge' | 'replace') => {
    if (!importPreview) return;
    applyBackup(importPreview.backup, mode);
    setImportPreview(null);
    // 匯入前已自動寫入安全備份 (finance_backup_before_import)；重新載入讓所有狀態一致
    window.location.reload();
  };

  const onboardingSteps = [
    {
      title: `認識${settings.petName || '小財'} 🐣`,
      body: `${settings.petName || '小財'}是你的財務小夥伴。開啟後牠會浮在手機畫面上陪著你——切到 LINE、Chrome 都還在。`,
      action: '下一步',
    },
    {
      title: '為什麼需要權限？',
      body: '「顯示在其他應用程式上層」讓桌寵能浮在其他 App 上。FinTracker 只用這個權限顯示桌寵，不讀取其他 App 的內容。',
      action: '下一步',
    },
    {
      title: '開啟權限',
      body: '接下來會前往 Android 設定，允許 FinTracker 顯示在上層，回來後桌寵就會出現。',
      action: busy ? '啟動中…' : '開啟桌寵',
    },
    {
      title: '完成！試試看 ✨',
      body: '按住桌寵可以拖曳、放開會吸附螢幕邊緣。點一下桌寵，記下你的第一筆吧！',
      action: '開始使用',
    },
  ];

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/*
        The page has to say something different depending on where it is
        running. In a browser the honest message is "this lives on your phone,
        here is how to get it" — the old copy said the pet "needs the Android
        app" and then showed a disabled 開啟桌寵 button, which reads as broken
        rather than as a different platform.
      */}
      {!runtimeEnvironment.isNativeApp ? (
        <AndroidDownloadCard variant="card" />
      ) : (
      <div className="glass rounded-[24px] p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-3xl shadow-inner border border-white/60">
            🐣
          </div>
          <div className="flex-1">
            <h2 className="font-extrabold text-[#5C5248] text-xl">{settings.petName || '小財'}</h2>
            <p className="text-sm text-[#82786D] font-bold flex items-center gap-1.5">
              {settings.enabled ? (
                <>
                  <span className={cn('w-2 h-2 rounded-full', status?.running ? 'bg-[#7D9D81]' : 'bg-[#D1A066]')} />
                  {status?.running ? '正在陪你' : '服務未執行（可重新開啟）'}
                </>
              ) : (
                '浮在手機畫面上，點一下就能快速記帳'
              )}
            </p>
          </div>
        </div>

        {settings.enabled ? (
          <button
            type="button"
            onClick={stopPetFlow}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-white border border-black/5 text-[#CD7A70] hover:bg-[#CD7A70]/5 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            關閉桌寵
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setOnboardingStep(0);
              setShowOnboarding(true);
            }}
            disabled={busy || !native}
            className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            開啟桌寵
          </button>
        )}
        {error && <p className="text-sm font-bold text-[#CD7A70]">{error}</p>}
      </div>
      )}

      {/* 最常調整的兩件事：牠多大、牠叫什麼 */}
      <Section title="桌寵">
        <OptionRow<PetSize>
          label="大小"
          value={settings.size}
          options={[
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' },
          ]}
          onSelect={v => update({ size: v })}
        />
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="text-sm font-bold text-[#5C5248] shrink-0">桌寵名稱</span>
          <input
            type="text"
            value={settings.petName}
            maxLength={8}
            onChange={e => update({ petName: e.target.value })}
            className="w-32 px-3 py-1.5 text-sm text-right bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none focus:ring-2 focus:ring-[#87A2B4]/40"
          />
        </div>
      </Section>

      {/* 記帳時真正會碰到的兩個開關 */}
      <Section title="快速記帳">
        <OptionRow
          label="預設類型"
          value={settings.defaultType}
          options={[
            { value: 'expense', label: '支出' },
            { value: 'income', label: '收入' },
          ]}
          onSelect={v => update({ defaultType: v as 'expense' | 'income' })}
        />
        <OptionRow
          label="快速模式"
          value={settings.fastMode ? 'fast' : 'confirm'}
          options={[
            { value: 'confirm', label: '確認後新增' },
            { value: 'fast', label: '點分類直接新增' },
          ]}
          onSelect={v => update({ fastMode: v === 'fast' })}
        />
      </Section>

      {/* 資料備份留在外面：這是資料安全，不是進階選項 */}
      <Section title="資料">
        <div className="flex gap-3 py-2">
          <button
            type="button"
            onClick={exportData}
            className="flex-1 py-3 rounded-2xl font-bold bg-white border border-black/5 text-[#5C5248] hover:bg-[#FAF6F0] transition-all active:scale-[0.98]"
          >
            匯出財務資料
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 py-3 rounded-2xl font-bold bg-white border border-black/5 text-[#5C5248] hover:bg-[#FAF6F0] transition-all active:scale-[0.98]"
          >
            匯入財務資料
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) onImportFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {importError && <p className="text-sm font-bold text-[#CD7A70]">{importError}</p>}
        <p className="text-xs text-[#82786D] font-bold">
          匯出為 JSON 檔（含交易、預算、目標、負債、定期與設定）。匯入取代前會自動建立安全備份。
        </p>
      </Section>

      {/*
        進階設定：預設收起。

        這裡面的東西一個都沒有被拿掉 —— 停靠邊、透明度、釘選分類、自訂分類、
        付款方式、隱私、帳號同步、權限診斷全都還在，只是不再是每天打開設定頁
        時第一眼要面對的六大區塊。
      */}
      <div className="glass rounded-[24px] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(v => !v)}
          aria-expanded={showAdvanced}
          className="w-full flex items-center justify-between gap-3 px-6 min-h-[56px] text-left"
        >
          <span className="font-extrabold text-[#5C5248]">進階設定</span>
          <span className="text-sm font-bold text-[#A79C90]">{showAdvanced ? '收起' : '展開'}</span>
        </button>
        {showAdvanced && (
          <div className="px-4 pb-4 space-y-4">
            <Section title="桌寵外觀">
              <OptionRow<PetEdge>
                label="停靠"
                value={settings.edge}
                options={[
                  { value: 'left', label: '左' },
                  { value: 'right', label: '右' },
                  { value: 'auto', label: '自動' },
                ]}
                onSelect={v => update({ edge: v })}
              />
              <OptionRow<PetAutoCollapse>
                label="自動收邊"
                value={settings.autoCollapse}
                options={[
                  { value: '5s', label: '5 秒' },
                  { value: '15s', label: '15 秒' },
                  { value: 'off', label: '永不' },
                ]}
                onSelect={v => update({ autoCollapse: v })}
              />
              <OptionRow<PetAnimationLevel>
                label="動畫"
                value={settings.animation}
                options={[
                  { value: 'full', label: '完整' },
                  { value: 'simple', label: '簡化' },
                ]}
                onSelect={v => update({ animation: v })}
              />
              <OptionRow<PetOpacity>
                label="透明度"
                value={settings.opacity}
                options={[
                  { value: '100', label: '100%' },
                  { value: '85', label: '85%' },
                  { value: '70', label: '70%' },
                ]}
                onSelect={v => update({ opacity: v })}
              />
            </Section>

            <Section title="快速記帳進階">
              <div className="py-3 border-b border-black/5">
                <p className="text-sm font-bold text-[#5C5248] mb-2">釘選常用分類（最多 4 個，會排在最前面）</p>
                <div className="flex flex-wrap gap-2">
                  {expenseCategories.map(def => (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => togglePinned(def.id)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-bold rounded-full border transition-all',
                        pinned.includes(def.id)
                          ? 'bg-[#87A2B4]/15 border-[#87A2B4] text-[#5C5248]'
                          : 'bg-white/60 border-black/5 text-[#82786D] hover:bg-white',
                      )}
                    >
                      {def.emoji} {def.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 自訂分類 */}
              <div className="py-3 border-b border-black/5">
                <p className="text-sm font-bold text-[#5C5248] mb-2">自訂分類</p>
                {customCategories.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {customCategories.map(c => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full bg-white/70 border border-black/5 text-[#5C5248]"
                      >
                        {c.emoji} {c.label}
                        <span className="text-[10px] text-[#82786D]">{c.type === 'income' ? '收入' : '支出'}</span>
                        <button
                          type="button"
                          aria-label={`刪除 ${c.label}`}
                          onClick={() => {
                            removeCustomCategory(c.id);
                            setCustomCategories(loadCustomCategories());
                          }}
                          className="text-[#CD7A70] hover:opacity-70 px-1"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCategoryEmoji}
                    onChange={e => setNewCategoryEmoji(e.target.value)}
                    maxLength={2}
                    aria-label="分類圖示"
                    className="w-14 px-2 py-2 text-center bg-white/70 border border-black/5 rounded-xl outline-none"
                  />
                  <input
                    type="text"
                    value={newCategoryLabel}
                    onChange={e => setNewCategoryLabel(e.target.value)}
                    placeholder="例如：寵物、旅遊"
                    maxLength={10}
                    aria-label="分類名稱"
                    className="flex-1 px-3 py-2 text-sm bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none"
                  />
                  <select
                    value={newCategoryType}
                    onChange={e => setNewCategoryType(e.target.value as 'expense' | 'income')}
                    aria-label="分類類型"
                    className="px-2 py-2 text-sm bg-white/70 border border-black/5 text-[#5C5248] font-bold rounded-xl outline-none"
                  >
                    <option value="expense">支出</option>
                    <option value="income">收入</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const result = addCustomCategory({
                        label: newCategoryLabel,
                        emoji: newCategoryEmoji,
                        type: newCategoryType,
                      });
                      if (!result.ok) {
                        setCategoryError(result.error ?? '');
                        return;
                      }
                      setCategoryError('');
                      setNewCategoryLabel('');
                      setNewCategoryEmoji('🏷️');
                      setCustomCategories(loadCustomCategories());
                    }}
                    className="px-4 py-2 text-sm font-bold rounded-xl bg-[#E2D8C6] text-[#5C5248] active:scale-95 transition-all"
                  >
                    新增
                  </button>
                </div>
                {categoryError && <p className="text-xs font-bold text-[#CD7A70] mt-2">{categoryError}</p>}
                <p className="text-xs text-[#82786D] font-bold mt-2">刪除分類不會更動任何既有交易。</p>
              </div>

              {/* 支付方式 */}
              <div className="py-3">
                <p className="text-sm font-bold text-[#5C5248] mb-2">支付方式（顯示在快速記帳）</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_PAYMENT_METHODS.map(pm => {
                    const enabled = paymentPrefs.enabled.includes(pm.id);
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => setPaymentPrefs(togglePaymentMethod(pm.id))}
                        className={cn(
                          'px-3 py-1.5 text-xs font-bold rounded-full border transition-all',
                          enabled
                            ? 'bg-[#87A2B4]/15 border-[#87A2B4] text-[#5C5248]'
                            : 'bg-white/60 border-black/5 text-[#82786D] hover:bg-white',
                        )}
                      >
                        {pm.emoji} {pm.label}
                      </button>
                    );
                  })}
                </div>
                {paymentPrefs.enabled.length > 1 && (
                  <div className="mt-3 space-y-1">
                    {paymentPrefs.enabled.map((id, index) => (
                      <div key={id} className="flex items-center gap-2 text-xs font-bold text-[#5C5248]">
                        <span className="w-5 text-[#82786D]">{index + 1}.</span>
                        <span className="flex-1">{paymentMethodLabel(id)}</span>
                        <button
                          type="button"
                          aria-label={`${paymentMethodLabel(id)} 上移`}
                          disabled={index === 0}
                          onClick={() => setPaymentPrefs(movePaymentMethod(id, -1))}
                          className="px-2 py-1 rounded-lg bg-white/70 border border-black/5 disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`${paymentMethodLabel(id)} 下移`}
                          disabled={index === paymentPrefs.enabled.length - 1}
                          onClick={() => setPaymentPrefs(movePaymentMethod(id, 1))}
                          className="px-2 py-1 rounded-lg bg-white/70 border border-black/5 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

            <Section title="隱私">
              <OptionRow<PetBubbleDisplay>
                label="泡泡顯示"
                value={settings.bubbleDisplay}
                options={[
                  { value: 'text', label: '只有文字' },
                  { value: 'count', label: '今日筆數' },
                  { value: 'todaySpend', label: '今日支出' },
                  { value: 'budget', label: '預算狀態' },
                ]}
                onSelect={v => update({ bubbleDisplay: v, showAmounts: bubbleShowsAmounts({ bubbleDisplay: v }) })}
              />
              <OptionRow
                label="App 鎖定"
                value={settings.appLock ? 'on' : 'off'}
                options={[
                  { value: 'off', label: '關' },
                  { value: 'on', label: '生物辨識 / 裝置密碼' },
                ]}
                onSelect={v => update({ appLock: v === 'on' })}
              />
              {settings.appLock && (
                <OptionRow
                  label="快速記帳"
                  value={settings.quickAddWithoutUnlock ? 'free' : 'locked'}
                  options={[
                    { value: 'free', label: '免解鎖' },
                    { value: 'locked', label: '也要驗證' },
                  ]}
                  onSelect={v => update({ quickAddWithoutUnlock: v === 'free' })}
                />
              )}
              <p className="text-xs text-[#82786D] font-bold pt-2">
                預設隱私模式：桌寵不會在畫面上顯示總資產、負債或帳戶餘額。
              </p>
            </Section>

            <Section title="帳號與同步">
              <AccountPanel />
            </Section>

            {native && (
              <Section title="權限與診斷">
                <div className="space-y-2 py-2 text-sm font-bold text-[#5C5248]">
                  {/*
                    Which commit is this site actually running? Without it, a page
                    that looks out of date is indistinguishable from a deploy that
                    never fired, and the only debugging tool is guessing.
                  */}
                  <div className="flex justify-between text-[#82786D]">
                    <span>網站版本</span>
                    <span className="font-mono text-xs">
                      {__BUILD_STAMP__.version} · {__BUILD_STAMP__.commit}
                    </span>
                  </div>
                  <div className="flex justify-between text-[#82786D]">
                    <span>建置時間</span>
                    <span className="font-mono text-xs">
                      {new Date(__BUILD_STAMP__.builtAt).toLocaleString('zh-TW')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>懸浮視窗權限</span>
                    <span>{status?.permissionGranted ? '✓ 已允許' : '✕ 未允許'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>通知權限</span>
                    <span>{status?.notificationsGranted === false ? '✕ 未允許' : '✓ 已允許'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>桌寵服務</span>
                    <span>{status?.running ? 'Running' : 'Stopped'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>待同步筆數</span>
                    <span>{status?.pendingCount ?? 0}</span>
                  </div>
                  {debugInfo && (
                    <div className="flex justify-between text-[#82786D]">
                      <span>上次同步</span>
                      <span>{debugInfo.lastSyncAt ? new Date(debugInfo.lastSyncAt).toLocaleString() : '—'}</span>
                    </div>
                  )}
                  {debugInfo && (
                    <div className="flex justify-between text-[#82786D]">
                      <span>位置</span>
                      <span>
                        {debugInfo.edge} ({debugInfo.positionX.toFixed(2)}, {debugInfo.positionY.toFixed(2)})
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[#82786D]">
                    <span>資料版本</span>
                    <span>v{storageVersion}</span>
                  </div>
                  <div className="flex justify-between text-[#82786D]">
                    <span>資料檢查</span>
                    <span>
                      {integrity
                        ? integrity.ok
                          ? `✓ ${integrity.transactionCount} 筆正常`
                          : `${integrity.issues.length} 項待確認`
                        : '—'}
                    </span>
                  </div>
                </div>
                {integrity && !integrity.ok && (
                  <ul className="mt-2 space-y-1 text-xs font-bold text-[#C08A5A]">
                    {integrity.issues.slice(0, 5).map((issue, i) => (
                      <li key={i}>• {issue.detail}</li>
                    ))}
                    {integrity.issues.length > 5 && <li>• 還有 {integrity.issues.length - 5} 項…</li>}
                  </ul>
                )}
                {settings.enabled && status && !status.permissionGranted && (
                  <button
                    type="button"
                    onClick={startPetFlow}
                    className="w-full mt-2 py-3 rounded-2xl font-bold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98]"
                  >
                    重新開啟權限
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    refreshStatus();
                    setIntegrity(runIntegrityCheck());
                  }}
                  className="w-full mt-2 py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
                >
                  重新整理狀態
                </button>
              </Section>
            )}
          </div>
        )}
      </div>


      {/* 匯入確認：合併 / 取代 / 取消 */}
      {importPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FAF6F0] w-full max-w-sm rounded-[28px] shadow-2xl p-7 space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="font-extrabold text-[#5C5248] text-lg">匯入財務資料</h3>
            <p className="text-sm text-[#82786D] font-bold leading-relaxed">
              備份時間：{importPreview.backup.exportedAt?.slice(0, 19).replace('T', ' ') ?? '未知'}
              <br />
              交易 {importPreview.validation.counts.transactions} 筆、預算 {importPreview.validation.counts.budgets} 項、
              目標 {importPreview.validation.counts.goals} 個、負債 {importPreview.validation.counts.debts} 筆
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => doImport('merge')}
                className="w-full py-3 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98]"
              >
                合併（保留現有資料）
              </button>
              <button
                type="button"
                onClick={() => doImport('replace')}
                className="w-full py-3 rounded-2xl font-extrabold bg-white border border-[#CD7A70]/40 text-[#CD7A70] hover:bg-[#CD7A70]/5 transition-all active:scale-[0.98]"
              >
                取代（會先自動備份現有資料）
              </button>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="w-full py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlay permission onboarding：分步說明，再導向系統設定 */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FAF6F0] w-full max-w-sm rounded-[28px] shadow-2xl p-8 text-center space-y-5 animate-in zoom-in-95 duration-200">
            <div className="text-6xl">🐣</div>
            <h3 className="font-extrabold text-[#5C5248] text-xl">{onboardingSteps[onboardingStep].title}</h3>
            <p className="text-sm text-[#82786D] font-bold leading-relaxed whitespace-pre-line">
              {onboardingSteps[onboardingStep].body}
            </p>
            <div className="flex justify-center gap-1.5">
              {onboardingSteps.map((_, i) => (
                <span
                  key={i}
                  className={cn('w-2 h-2 rounded-full', i === onboardingStep ? 'bg-[#87A2B4]' : 'bg-[#E2D8C6]')}
                />
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (onboardingStep === 2) startPetFlow();
                else if (onboardingStep === 3) setShowOnboarding(false);
                else setOnboardingStep(s => s + 1);
              }}
              className="w-full py-3.5 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {onboardingSteps[onboardingStep].action}
            </button>
            {onboardingStep < 3 && (
              <button
                type="button"
                onClick={() => setShowOnboarding(false)}
                className="w-full py-2 text-sm font-bold text-[#82786D] hover:text-[#5C5248] transition-colors"
              >
                先不要
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
