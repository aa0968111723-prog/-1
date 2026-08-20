import { useEffect, useState } from 'react';
import { Download, ShieldCheck, Smartphone, ChevronDown, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import {
  ReleaseManifest,
  fetchLatestRelease,
  formatBytes,
  androidApiLabel,
  DOWNLOAD_PAGE_PATH,
} from '../lib/appRelease';
import { runtimeEnvironment } from '../lib/runtimeEnvironment';
import { cn } from '../lib/utils';

/**
 * The answer to "使用者要去哪裡下載 App？".
 *
 * Everything shown here comes from the release manifest CI publishes. Nothing
 * about a version is written in this file, because a hardcoded version string
 * in React is how a site advertises 1.0.0 three releases later and offers a
 * download link to an APK that no longer exists.
 *
 * What it deliberately does NOT do is claim to know whether the app is already
 * installed. A browser cannot reliably detect a sideloaded app, and guessing
 * wrong means either hiding the download from someone who needs it or telling
 * someone who just installed it to install it again. So: always offer the
 * download, and offer a deep link beside it for people who already have it.
 */

interface Props {
  /** 'card' sits at the top of the pet page; 'page' is the standalone landing page. */
  variant?: 'card' | 'page';
}

export default function AndroidDownloadCard({ variant = 'card' }: Props) {
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [error, setError] = useState<'offline' | 'not-published' | 'malformed' | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const env = runtimeEnvironment;

  // A counter rather than a bare function, so the effect owns cancellation and
  // a retry cannot race an in-flight request into setting stale state.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLatestRelease().then(result => {
      if (cancelled) return;
      setManifest(result.manifest);
      setError(result.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const downloadPageUrl = `${siteUrl}${DOWNLOAD_PAGE_PATH}`;
  // A QR code for a desktop visitor must point at the download PAGE, not the
  // raw APK: scanning straight into a binary download gives no install
  // instructions and no checksum to check against.
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(downloadPageUrl)}`;

  return (
    <div className={cn('glass rounded-[24px] overflow-hidden', variant === 'page' ? 'p-8' : 'p-6')}>
      <div className="flex items-start gap-4">
        <div className="w-16 h-16 shrink-0 rounded-full bg-gradient-to-br from-[#FFE9A8] to-[#F7C873] flex items-center justify-center text-3xl shadow-inner border border-white/60">
          🐣
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-extrabold text-[#5C5248] text-xl">小財桌寵</h2>
          <p className="text-sm text-[#82786D] font-bold mt-0.5">讓小財住進你的手機</p>
        </div>
      </div>

      <ul className="mt-5 space-y-2">
        {[
          '手機桌面浮動，切到別的 App 也還在',
          '點一下快速記帳，兩三秒就記完',
          '沒有網路也能記，資料先存在手機裡',
          '登入後自動與這個帳號同步',
        ].map(line => (
          <li key={line} className="flex items-start gap-2 text-sm font-bold text-[#5C5248]">
            <span className="text-[#7D9D81] mt-0.5">✓</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {loading ? (
          <div className="w-full py-3.5 rounded-2xl bg-[#EAE4DB]/60 flex items-center justify-center gap-2 text-[#82786D] font-bold">
            <Loader2 size={18} className="animate-spin" />
            正在查詢最新版本…
          </div>
        ) : manifest ? (
          <>
            <a
              href={manifest.apkUrl}
              className="w-full py-4 rounded-2xl font-extrabold bg-[#87A2B4] text-white hover:bg-[#87A2B4]/90 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <Download size={20} />
              下載 Android App
            </a>
            <p className="mt-2 text-center text-xs font-bold text-[#A79C90]">
              版本 {manifest.version}　·　{androidApiLabel(manifest.minAndroid)} 以上　·　{formatBytes(manifest.size)}
              {manifest.channel === 'internal' && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-[#D1A066]/20 text-[#8A6634]">內部測試版</span>
              )}
              {manifest.signing === 'debug' && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-[#D1A066]/20 text-[#8A6634]">測試簽章</span>
              )}
            </p>
          </>
        ) : (
          <div className="w-full p-4 rounded-2xl bg-[#EAE4DB]/60 text-center space-y-2">
            <p className="text-sm font-extrabold text-[#5C5248]">
              {error === 'not-published'
                ? 'Android App 尚未發布'
                : error === 'malformed'
                  ? '版本資訊讀取失敗'
                  : '目前連不上版本資訊'}
            </p>
            <p className="text-xs font-bold text-[#A79C90]">
              {error === 'not-published'
                ? '第一個版本發布之後，這裡就會出現下載按鈕。'
                : '可能是網路問題，也可能是發布服務暫時無法連線。'}
            </p>
            {/*
              A dead end with no action is the worst version of this state. The
              manifest is fetched once on mount, so without this the only way to
              retry is a full page reload.
            */}
            <button
              type="button"
              onClick={() => setReloadToken(t => t + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-black/5 text-xs font-extrabold text-[#5C5248] hover:bg-black/[0.02] transition-all active:scale-[0.98]"
            >
              <RefreshCw size={13} /> 重新讀取版本
            </button>
          </div>
        )}
      </div>

      {/* 已經裝過的人：不假裝偵測得到，直接給一條路 */}
      {!env.isNativeApp && (
        <a
          href="fintracker://open"
          className="mt-3 w-full py-2.5 rounded-2xl font-bold text-sm text-[#82786D] hover:text-[#5C5248] hover:bg-white/60 transition-all flex items-center justify-center gap-1.5"
        >
          已經安裝了？開啟小財
          <ExternalLink size={14} />
        </a>
      )}

      {/* 桌機：掃碼帶到下載頁，不是直接丟 APK */}
      {env.isDesktopBrowser && manifest && (
        <div className="mt-6 pt-6 border-t border-black/5 flex items-center gap-5">
          <img
            src={qrSrc}
            alt={`掃描開啟 ${downloadPageUrl}`}
            width={110}
            height={110}
            className="rounded-xl bg-white p-1.5 border border-black/5 shrink-0"
          />
          <div className="min-w-0">
            <p className="font-extrabold text-[#5C5248] text-sm flex items-center gap-1.5">
              <Smartphone size={16} /> 用 Android 手機掃描
            </p>
            <p className="text-xs font-bold text-[#82786D] mt-1 leading-relaxed">
              桌寵是手機上的功能。用手機掃這個 QR Code 會開啟下載頁，那裡有安裝說明。
            </p>
          </div>
        </div>
      )}

      {manifest && (
        <div className="mt-4 pt-4 border-t border-black/5">
          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            className="w-full flex items-center justify-between text-xs font-bold text-[#82786D] hover:text-[#5C5248]"
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} /> 檔案資訊與安裝說明
            </span>
            <ChevronDown size={14} className={cn('transition-transform', showDetails && 'rotate-180')} />
          </button>

          {showDetails && (
            <div className="mt-3 space-y-3 text-xs font-bold text-[#82786D]">
              <dl className="space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt>版本</dt>
                  <dd className="text-[#5C5248]">{manifest.version}（versionCode {manifest.versionCode}）</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>檔案大小</dt>
                  <dd className="text-[#5C5248]">{formatBytes(manifest.size)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>發布時間</dt>
                  <dd className="text-[#5C5248]">{new Date(manifest.releasedAt).toLocaleString('zh-TW')}</dd>
                </div>
                <div>
                  <dt className="mb-1">SHA-256</dt>
                  <dd className="text-[#5C5248] font-mono text-[10px] break-all leading-relaxed bg-[#EAE4DB]/50 p-2 rounded-lg">
                    {manifest.sha256}
                  </dd>
                </div>
              </dl>

              {manifest.signing === 'debug' && (
                <div className="pt-2 border-t border-black/5 leading-relaxed space-y-1.5">
                  <p className="text-[#5C5248]">關於「測試簽章」</p>
                  <p>
                    這個版本用的是 Android 的預設測試金鑰，可以正常安裝使用，
                    但它不是正式簽章：任何人都能做出一個 Android 會當成「同一個 App」的更新檔。
                    自己裝來用沒問題，先不要散布給不認識的人。
                  </p>
                  <p>正式金鑰建立之後，會需要先移除這個版本再安裝新的。</p>
                </div>
              )}

              <div className="pt-2 border-t border-black/5 leading-relaxed space-y-1.5">
                <p className="text-[#5C5248]">安裝步驟</p>
                <p>
                  這個 App 不是從 Google Play 安裝的，所以 Android 會先問你要不要允許從瀏覽器安裝。
                  點下載後開啟檔案，看到提示時選「設定」→ 允許這個來源安裝 → 返回繼續安裝即可。
                </p>
                <p>
                  這是 Android 對非商店來源的正常確認，只會影響「從這個來源安裝」這一項，
                  不會關閉手機本身的任何安全防護，之後也可以在設定裡改回來。
                </p>
                <p className="pt-1">
                  想確認檔案沒有被動過，可以比對上面的 SHA-256：
                  <code className="ml-1 font-mono text-[10px]">sha256sum fintracker-{manifest.version}.apk</code>
                </p>
              </div>

              {manifest.notes && (
                <div className="pt-2 border-t border-black/5">
                  <p className="text-[#5C5248] mb-1">這個版本</p>
                  <p className="leading-relaxed">{manifest.notes}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
