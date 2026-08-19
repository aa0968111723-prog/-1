package com.fintracker.app.pet

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Lightweight transparent bottom-sheet container for pet quick entry.
 *
 * It opens in well under a second (no WebView, no splash, no dashboard) and
 * only captures a transaction draft into PendingTransactionQueue — the web
 * FinanceRepository remains the single source of truth and drains the queue
 * through the exact same addTransaction path as every other entry.
 */
class QuickAddActivity : AppCompatActivity() {

    private data class Chip(val emoji: String, val label: String, val category: String, val note: String = "")

    private val expenseChips = listOf(
        Chip("🍱", "餐飲", "餐飲美食"),
        Chip("🥤", "飲料", "餐飲美食", "飲料"),
        Chip("🚌", "交通", "交通出行"),
        Chip("🛍️", "購物", "購物消費"),
        Chip("🎮", "娛樂", "休閒娛樂"),
        Chip("📦", "其他", "其他支出"),
    )
    private val incomeChips = listOf(
        Chip("💰", "薪資", "薪資收入"),
        Chip("🧧", "獎金", "零星獎金"),
        Chip("📈", "投資", "投資理財"),
        Chip("✨", "其他", "其他收入"),
    )

    private lateinit var prefs: PetPrefs
    private var type: String = "expense"
    private var selectedChip: Chip? = null
    private val chipViews = mutableMapOf<Chip, View>()

    private lateinit var amountInput: EditText
    private lateinit var noteInput: EditText
    private lateinit var expenseToggle: TextView
    private lateinit var incomeToggle: TextView
    private lateinit var categoryGrid: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = PetPrefs(this)
        setContentView(com.fintracker.app.R.layout.activity_quick_add)

        type = intent.getStringExtra(EXTRA_TYPE) ?: "expense"

        amountInput = findViewById(com.fintracker.app.R.id.amount_input)
        noteInput = findViewById(com.fintracker.app.R.id.note_input)
        expenseToggle = findViewById(com.fintracker.app.R.id.type_expense)
        incomeToggle = findViewById(com.fintracker.app.R.id.type_income)
        categoryGrid = findViewById(com.fintracker.app.R.id.category_grid)

        findViewById<View>(com.fintracker.app.R.id.quick_add_root).setOnClickListener { finish() }
        findViewById<View>(com.fintracker.app.R.id.quick_add_sheet).setOnClickListener { /* swallow */ }
        findViewById<View>(com.fintracker.app.R.id.quick_add_close).setOnClickListener { finish() }
        findViewById<View>(com.fintracker.app.R.id.save_button).setOnClickListener { save(selectedChip) }

        expenseToggle.setOnClickListener { setType("expense") }
        incomeToggle.setOnClickListener { setType("income") }

        if (prefs.settings().fastMode) {
            findViewById<View>(com.fintracker.app.R.id.fast_mode_hint).visibility = View.VISIBLE
        }

        setType(type)

        // 金額自動 focus + 數字鍵盤：點桌寵 → 直接打數字
        amountInput.requestFocus()
        amountInput.post {
            val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(amountInput, InputMethodManager.SHOW_IMPLICIT)
        }
    }

    private fun setType(newType: String) {
        type = newType
        selectedChip = null
        val active = 0xFF5C5248.toInt()
        val inactive = 0xFF82786D.toInt()
        if (type == "expense") {
            expenseToggle.setBackgroundResource(com.fintracker.app.R.drawable.quick_add_toggle_selected_bg)
            incomeToggle.background = null
            expenseToggle.setTextColor(active)
            incomeToggle.setTextColor(inactive)
        } else {
            incomeToggle.setBackgroundResource(com.fintracker.app.R.drawable.quick_add_toggle_selected_bg)
            expenseToggle.background = null
            incomeToggle.setTextColor(active)
            expenseToggle.setTextColor(inactive)
        }
        buildChips()
    }

    private fun buildChips() {
        categoryGrid.removeAllViews()
        chipViews.clear()
        val chips = if (type == "expense") expenseChips else incomeChips
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
                setBackgroundResource(com.fintracker.app.R.drawable.quick_add_chip_bg)
                setPadding(0, dp(10), 0, dp(10))
                addView(TextView(this@QuickAddActivity).apply {
                    text = chip.emoji
                    textSize = 22f
                    gravity = android.view.Gravity.CENTER
                })
                addView(TextView(this@QuickAddActivity).apply {
                    text = chip.label
                    textSize = 12f
                    setTextColor(0xFF5C5248.toInt())
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
        // pad the final row so chips keep equal width
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

    private fun onChipTapped(chip: Chip) {
        // 超高速模式：金額 + 分類 = 直接完成，不用再按 Submit
        if (prefs.settings().fastMode && parseAmount() != null) {
            save(chip)
            return
        }
        selectedChip = chip
        chipViews.forEach { (c, v) -> v.isSelected = c == chip }
    }

    private fun parseAmount(): Double? {
        val raw = amountInput.text?.toString()?.trim().orEmpty()
        val value = raw.toDoubleOrNull() ?: return null
        return if (value > 0) value else null
    }

    private fun save(chip: Chip?) {
        val amount = parseAmount()
        if (amount == null) {
            amountInput.error = getString(com.fintracker.app.R.string.pet_amount_required)
            return
        }
        val resolvedChip = chip ?: selectedChip
        if (resolvedChip == null) {
            android.widget.Toast.makeText(
                this,
                getString(com.fintracker.app.R.string.pet_category_required),
                android.widget.Toast.LENGTH_SHORT,
            ).show()
            return
        }
        val note = noteInput.text?.toString()?.trim().orEmpty().ifEmpty { resolvedChip.note }
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val tx = PendingTransactionCodec.PendingTransaction(
            id = UUID.randomUUID().toString(),
            type = type,
            amount = amount,
            category = resolvedChip.category,
            date = today,
            note = note,
            paymentMethod = prefs.lastPaymentMethod, // 自動使用上次選擇
        )
        PendingTransactionQueue.add(prefs.prefs, tx)

        // Tell the WebView (if alive) to drain immediately, and let the pet celebrate.
        PetActionBridge.emit(PetActionBridge.EVENT_TRANSACTION_QUEUED)
        if (FloatingPetService.running) {
            startService(
                Intent(this, FloatingPetService::class.java)
                    .setAction(FloatingPetService.ACTION_SHOW_SUCCESS)
                    .putExtra(FloatingPetService.EXTRA_MESSAGE, "記好啦！"),
            )
        }
        finish()
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    companion object {
        const val EXTRA_TYPE = "type"
    }
}
