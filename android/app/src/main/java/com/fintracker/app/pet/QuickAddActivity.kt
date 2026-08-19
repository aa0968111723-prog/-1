package com.fintracker.app.pet

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import com.fintracker.app.R
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Lightweight transparent bottom-sheet container for pet quick entry.
 *
 * Opens in well under a second (no WebView, no splash, no dashboard) and
 * only captures a transaction draft into the durable native outbox
 * (PendingTransactionQueue) — the web FinanceRepository remains the single
 * source of truth and drains the outbox idempotently through the exact same
 * addTransaction path as every other entry.
 *
 * Categories, payment methods and NL parsing rules all come from the shared
 * config / web-synced chips — never hardcoded here.
 */
class QuickAddActivity : AppCompatActivity() {

    private lateinit var prefs: PetPrefs
    private var type: String = "expense"
    private var selectedChip: PetSharedConfigCore.Chip? = null
    private var selectedPaymentId: String = "cash"
    private var parsedPaymentOverride: String? = null
    private val chipViews = mutableMapOf<PetSharedConfigCore.Chip, View>()
    private val paymentViews = mutableMapOf<String, TextView>()

    private lateinit var amountInput: EditText
    private lateinit var noteInput: EditText
    private lateinit var nlInput: EditText
    private lateinit var expenseToggle: TextView
    private lateinit var incomeToggle: TextView
    private lateinit var categoryGrid: LinearLayout
    private lateinit var sheet: View
    private lateinit var undoBar: View

    private var lastSavedId: String? = null
    private val finishRunnable = Runnable { finish() }

    private val voiceLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val spoken = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
        if (!spoken.isNullOrBlank()) {
            nlInput.setText(spoken)
            applyParsed(spoken, fromVoice = true)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = PetPrefs(this)
        setContentView(R.layout.activity_quick_add)

        type = intent.getStringExtra(EXTRA_TYPE) ?: "expense"
        selectedPaymentId = prefs.lastPaymentMethod // 自動使用上次選擇

        // 讓桌寵知道 Quick Add 開著（期間不 edge peek）
        if (FloatingPetService.running) {
            startService(
                Intent(this, FloatingPetService::class.java)
                    .setAction(FloatingPetService.ACTION_QUICKADD_SHOWN),
            )
        }

        amountInput = findViewById(R.id.amount_input)
        noteInput = findViewById(R.id.note_input)
        nlInput = findViewById(R.id.nl_input)
        expenseToggle = findViewById(R.id.type_expense)
        incomeToggle = findViewById(R.id.type_income)
        categoryGrid = findViewById(R.id.category_grid)
        sheet = findViewById(R.id.quick_add_sheet)
        undoBar = findViewById(R.id.undo_bar)

        findViewById<View>(R.id.quick_add_root).setOnClickListener { finish() }
        sheet.setOnClickListener { /* swallow */ }
        findViewById<View>(R.id.quick_add_close).setOnClickListener { finish() }
        findViewById<View>(R.id.save_button).setOnClickListener { save(selectedChip) }
        findViewById<View>(R.id.undo_button).setOnClickListener { undoLastSave() }

        val moreSection = findViewById<View>(R.id.more_section)
        findViewById<TextView>(R.id.more_toggle).setOnClickListener {
            moreSection.visibility = if (moreSection.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }

        expenseToggle.setOnClickListener { setType("expense") }
        incomeToggle.setOnClickListener { setType("income") }

        if (prefs.settings().fastMode) {
            findViewById<View>(R.id.fast_mode_hint).visibility = View.VISIBLE
        }

        // Enter/Done 直接完成（已選分類時）
        amountInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE && selectedChip != null) {
                save(selectedChip)
                true
            } else false
        }
        nlInput.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                applyParsed(nlInput.text?.toString().orEmpty(), fromVoice = false)
                true
            } else false
        }
        findViewById<View>(R.id.voice_button).setOnClickListener { startVoiceInput() }

        // IME insets: 鍵盤彈出時墊高 sheet，儲存鈕永遠可見
        ViewCompat.setOnApplyWindowInsetsListener(sheet) { v, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            v.updatePadding(bottom = dp(16) + maxOf(ime.bottom, nav.bottom))
            insets
        }

        setType(type)
        buildPaymentRow()

        if (intent.getBooleanExtra(EXTRA_VOICE, false)) {
            startVoiceInput()
        } else {
            // 金額自動 focus + 數字鍵盤：點桌寵 → 直接打數字
            amountInput.requestFocus()
            amountInput.post {
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(amountInput, InputMethodManager.SHOW_IMPLICIT)
            }
        }
    }

    override fun onDestroy() {
        undoBar.removeCallbacks(finishRunnable)
        if (FloatingPetService.running) {
            runCatching {
                startService(
                    Intent(this, FloatingPetService::class.java)
                        .setAction(FloatingPetService.ACTION_QUICKADD_HIDDEN),
                )
            }
        }
        super.onDestroy()
    }

    // ---- type / chips / payments ----

    private fun setType(newType: String) {
        type = newType
        selectedChip = null
        val active = getColor(R.color.pet_text_primary)
        val inactive = getColor(R.color.pet_text_secondary)
        if (type == "expense") {
            expenseToggle.setBackgroundResource(R.drawable.quick_add_toggle_selected_bg)
            incomeToggle.background = null
            expenseToggle.setTextColor(active)
            incomeToggle.setTextColor(inactive)
        } else {
            incomeToggle.setBackgroundResource(R.drawable.quick_add_toggle_selected_bg)
            expenseToggle.background = null
            incomeToggle.setTextColor(active)
            expenseToggle.setTextColor(inactive)
        }
        buildChips()
    }

    private fun buildChips() {
        categoryGrid.removeAllViews()
        chipViews.clear()
        // Web-synced usage-ranked chips, falling back to shared defaults.
        val chips = PetSharedConfig.chips(this, prefs, type).take(6)
        var row: LinearLayout? = null
        chips.forEachIndexed { index, chip ->
            if (index % 3 == 0) {
                row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                categoryGrid.addView(
                    row,
                    LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT,
                    ).apply { if (index > 0) topMargin = dp(8) },
                )
            }
            val chipView = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                minimumHeight = dp(56)
                setBackgroundResource(R.drawable.quick_add_chip_bg)
                setPadding(0, dp(8), 0, dp(8))
                contentDescription = "${chip.label}（${chip.categoryLabel}）"
                addView(TextView(this@QuickAddActivity).apply {
                    text = chip.emoji
                    textSize = 22f
                    gravity = android.view.Gravity.CENTER
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                })
                addView(TextView(this@QuickAddActivity).apply {
                    text = chip.label
                    textSize = 12f
                    setTextColor(getColor(R.color.pet_text_primary))
                    gravity = android.view.Gravity.CENTER
                })
                setOnClickListener { onChipTapped(chip) }
            }
            chipViews[chip] = chipView
            row?.addView(
                chipView,
                LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                    if (index % 3 != 0) leftMargin = dp(8)
                },
            )
        }
        val remainder = chips.size % 3
        if (remainder != 0) {
            repeat(3 - remainder) {
                row?.addView(
                    View(this),
                    LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = dp(8) },
                )
            }
        }
    }

    private fun buildPaymentRow() {
        val rowView = findViewById<LinearLayout>(R.id.payment_row)
        rowView.removeAllViews()
        paymentViews.clear()
        PetSharedConfig.paymentMethods(this).forEach { pm ->
            val chip = TextView(this).apply {
                text = pm.label
                textSize = 12f
                minHeight = dp(40)
                gravity = android.view.Gravity.CENTER
                setPadding(dp(14), dp(8), dp(14), dp(8))
                setBackgroundResource(R.drawable.quick_add_chip_bg)
                contentDescription = "支付方式：${pm.label}"
                setOnClickListener { selectPayment(pm.id) }
            }
            paymentViews[pm.id] = chip
            rowView.addView(
                chip,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                ).apply { rightMargin = dp(8) },
            )
        }
        selectPayment(selectedPaymentId)
    }

    private fun selectPayment(id: String) {
        selectedPaymentId = if (paymentViews.containsKey(id)) id else paymentViews.keys.firstOrNull() ?: "cash"
        paymentViews.forEach { (pid, v) ->
            v.isSelected = pid == selectedPaymentId
            v.setTextColor(getColor(if (pid == selectedPaymentId) R.color.pet_text_primary else R.color.pet_text_secondary))
        }
    }

    private fun onChipTapped(chip: PetSharedConfigCore.Chip) {
        // 超高速模式：金額 + 分類 = 直接完成，不用再按 Submit
        if (prefs.settings().fastMode && parseAmount() != null) {
            save(chip)
            return
        }
        selectedChip = chip
        chipViews.forEach { (c, v) -> v.isSelected = c == chip }
    }

    // ---- NL / voice ----

    private fun startVoiceInput() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-TW")
            putExtra(RecognizerIntent.EXTRA_PROMPT, getString(R.string.pet_nl_hint))
        }
        runCatching { voiceLauncher.launch(intent) }
            .onFailure {
                Toast.makeText(this, getString(R.string.pet_voice_unavailable), Toast.LENGTH_SHORT).show()
            }
    }

    /**
     * Runs the shared deterministic parser and fills the form for the user
     * to confirm — voice/NL input never saves without confirmation: the user
     * still taps 記下來 (or a chip in fast mode).
     */
    private fun applyParsed(text: String, fromVoice: Boolean) {
        if (text.isBlank()) return
        val parsed = NativeQuickParser.parse(PetSharedConfig.raw(this), text)
        if (parsed.amount == null && parsed.categoryId == null) {
            Toast.makeText(this, getString(R.string.pet_amount_required), Toast.LENGTH_SHORT).show()
            return
        }
        if (parsed.type != type) setType(parsed.type)
        parsed.amount?.let { amountInput.setText(formatAmount(it)) }
        if (parsed.note.isNotBlank()) noteInput.setText(parsed.note)
        parsed.paymentMethodId?.let {
            parsedPaymentOverride = it
            selectPayment(it)
        }
        val chip = chipViews.keys.firstOrNull { it.categoryId == parsed.categoryId && it.note.isEmpty() }
        if (chip != null) {
            selectedChip = chip
            chipViews.forEach { (c, v) -> v.isSelected = c == chip }
        }
        if (fromVoice) {
            findViewById<View>(R.id.more_section).visibility = View.VISIBLE
        }
    }

    // ---- save / undo ----

    private fun parseAmount(): Double? {
        val raw = amountInput.text?.toString()?.trim().orEmpty()
        val value = raw.toDoubleOrNull() ?: return null
        return if (value > 0) value else null
    }

    private fun save(chip: PetSharedConfigCore.Chip?) {
        val amount = parseAmount()
        if (amount == null) {
            amountInput.error = getString(R.string.pet_amount_required)
            return
        }
        val resolvedChip = chip ?: selectedChip
        if (resolvedChip == null) {
            Toast.makeText(this, getString(R.string.pet_category_required), Toast.LENGTH_SHORT).show()
            return
        }
        val note = noteInput.text?.toString()?.trim().orEmpty().ifEmpty { resolvedChip.note }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val tx = PendingTransactionCodec.PendingTransaction(
            id = UUID.randomUUID().toString(),
            type = type,
            amount = amount,
            category = resolvedChip.categoryLabel,
            date = today,
            note = note,
            paymentMethod = selectedPaymentId,
            createdAt = System.currentTimeMillis(),
            source = if (parsedPaymentOverride != null) "pet_voice" else "pet_quick_add",
        )
        // Durable outbox write first — this IS the record until the web acks.
        PendingTransactionQueue.add(prefs.prefs, tx)
        prefs.lastPaymentMethod = selectedPaymentId
        lastSavedId = tx.id

        window.decorView.performHapticFeedback(HapticFeedbackConstants.CONFIRM)

        // Tell the WebView (if alive) to drain immediately, and let the pet celebrate.
        PetActionBridge.emit(PetActionBridge.EVENT_TRANSACTION_QUEUED)
        if (FloatingPetService.running) {
            startService(
                Intent(this, FloatingPetService::class.java)
                    .setAction(FloatingPetService.ACTION_SHOW_SUCCESS)
                    .putExtra(FloatingPetService.EXTRA_MESSAGE, "記好啦！"),
            )
        }
        showUndoThenFinish(tx, resolvedChip)
    }

    /** 快速模式誤按保險：3.5 秒內可復原，之後自動關閉。 */
    private fun showUndoThenFinish(
        tx: PendingTransactionCodec.PendingTransaction,
        chip: PetSharedConfigCore.Chip,
    ) {
        sheet.visibility = View.GONE
        val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(amountInput.windowToken, 0)
        findViewById<TextView>(R.id.undo_text).text =
            "🐣 已記錄 NT$${formatAmount(tx.amount)} ${chip.label}"
        undoBar.visibility = View.VISIBLE
        undoBar.postDelayed(finishRunnable, UNDO_WINDOW_MS)
    }

    private fun undoLastSave() {
        val id = lastSavedId ?: return
        lastSavedId = null
        undoBar.removeCallbacks(finishRunnable)
        // The web may have drained the entry within the undo window — remove
        // it from the outbox AND tell the web to reconcile by id.
        PendingTransactionQueue.remove(prefs.prefs, id)
        PetActionBridge.emit(PetActionBridge.EVENT_TRANSACTION_UNDONE, id)
        undoBar.visibility = View.GONE
        sheet.visibility = View.VISIBLE
        amountInput.setText("")
        amountInput.requestFocus()
    }

    private fun formatAmount(v: Double): String =
        if (v == Math.floor(v) && !v.isInfinite()) v.toLong().toString() else v.toString()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_TYPE = "type"
        const val EXTRA_VOICE = "voice"
        private const val UNDO_WINDOW_MS = 3500L
    }
}
