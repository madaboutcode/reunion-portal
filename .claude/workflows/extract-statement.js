export const meta = {
  name: 'extract-statement',
  description: 'PDF FALLBACK: transcribe bank statement PDF pages to structured JSON with adversarial validation',
  whenToUse: 'Only when your bank gives a PDF statement and no HTML/text export. If you bank with SBI, use scripts/convert-sbi-html-to-text.py and import the .txt in /staff/bank-transactions instead (primary path). Run before cross-referencing payments.',
  phases: [
    { title: 'Transcribe', detail: 'One agent per page extracts every transaction row into JSON' },
    { title: 'Validate', detail: 'GAN-style adversarial review — second agent tries to FIND mistakes in each transcription' },
  ],
}

// PDF fallback for payment reconciliation (see .claude/skills/payment-reconcile/SKILL.md).
//
// This is a Workflow-tool script, not a Node script: it uses agent() and
// parallel(), which exist only inside the Claude Code Workflow runtime. Do not run it with `node`.
//
// Order of use:
//   1. uv run scripts/build-statement-images.py path/to/statement.pdf
//      -> writes tmp/statement-pages/page-01.png, page-02.png, ... (contains financial data; delete when done)
//   2. Ask Claude Code to run the "extract-statement" workflow with
//      args: { pages: ["<repo>/tmp/statement-pages/page-01.png", ...] }  (absolute paths, one per page)
//
// Output: JSON { transactions, total_count, page_results, error_pages, total_errors, has_issues }.
// It is a transcription for matching payments by hand or with an agent. The staff import in
// /staff/bank-transactions accepts only SBI-format .txt/.xls files, so this JSON is not imported directly.
//
// The sender-name and reference parsing below assumes SBI description formats (UPI, IMPS, NEFT, SBIY).
// For another bank, adjust extractSender() and extractRef().

const TXN_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          post_date: { type: 'string', description: 'DD-MM-YYYY' },
          value_date: { type: 'string', description: 'DD-MM-YYYY' },
          description: { type: 'string', description: 'Full multi-line description text' },
          credit: { type: ['number', 'null'] },
          debit: { type: ['number', 'null'] },
          balance: { type: 'number' },
        },
        required: ['post_date', 'value_date', 'description', 'credit', 'debit', 'balance'],
      },
    },
    brought_forward: { type: ['number', 'null'], description: 'Balance from BROUGHT FORWARD row if present on this page' },
    closing_balance: { type: ['number', 'null'], description: 'CLOSING BALANCE if present on this page' },
  },
  required: ['page', 'transactions'],
}

const VALIDATION_SCHEMA = {
  type: 'object',
  properties: {
    page: { type: 'integer' },
    is_valid: { type: 'boolean' },
    transcribed_count: { type: 'integer', description: 'How many txn rows the transcription has' },
    actual_count: { type: 'integer', description: 'How many txn rows you count in the image' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row_index: { type: 'integer', description: '0-based index in the transactions array' },
          field: { type: 'string' },
          image_value: { type: 'string', description: 'What the image actually shows' },
          transcribed_value: { type: 'string', description: 'What the transcription says' },
          severity: { type: 'string', enum: ['critical', 'warning'] },
        },
        required: ['field', 'image_value', 'transcribed_value', 'severity'],
      },
    },
    balance_chain_valid: { type: 'boolean', description: 'True if prev_balance +/- credit/debit = next_balance for all consecutive rows' },
  },
  required: ['page', 'is_valid', 'transcribed_count', 'actual_count', 'errors', 'balance_chain_valid'],
}

const TRANSCRIBE_PROMPT = (pagePath, pageNum) => `You are transcribing a bank statement page image into structured JSON. Read the image at ${pagePath}. This is page ${pageNum}.

CRITICAL RULES:
1. Extract EVERY transaction row. Missing even one row is an unacceptable error.
2. The description field must contain the COMPLETE multi-line text of the description cell — every line, including "DEP TFR", the UPI/IMPS/NEFT reference, sender info, account numbers, and "AT 00001 YOUR BRANCH". Concatenate all lines with a single space between them.
3. Amounts: remove commas, return as plain numbers. "14,310.00" becomes 14310.00. "8,500.00" becomes 8500.00.
4. Dates: use DD-MM-YYYY format exactly as shown in the Post Date column.
5. credit/debit: set to null if the column is empty for that row.
6. If you see a "BROUGHT FORWARD" row, put its balance in brought_forward, NOT as a transaction.
7. If you see a "CLOSING BALANCE" row, put its balance in closing_balance, NOT as a transaction.
8. After transcribing, VERIFY your work: count your transaction rows and cross-check that each balance follows from the previous one (prev_balance + credit - debit = this_balance).

Set page to ${pageNum}.`

const VALIDATE_PROMPT = (pagePath, pageNum, transcription) => `You are an ADVERSARIAL VALIDATOR. Your job is to FIND MISTAKES, not confirm correctness. Assume the transcription contains errors until proven otherwise.

Read the bank statement page image at ${pagePath} (page ${pageNum}) and compare against this transcription:

${JSON.stringify(transcription, null, 2)}

VALIDATION PROCEDURE:
1. Read the image INDEPENDENTLY. Count every transaction row yourself (exclude headers, BROUGHT FORWARD, CLOSING BALANCE).
2. Compare your row count to transcribed_count. Row count mismatch = CRITICAL error.
3. For EACH row, check ALL fields against the image:
   - post_date: exact match?
   - value_date: exact match?
   - description: ALL text present? Any truncation? Missing lines? Especially watch the UPI/IMPS/NEFT reference numbers — single digit transposition here means a wrong match.
   - credit/debit: exact amount? Watch for: 13810 vs 13180, 15580 vs 15508, 8500 vs 850.
   - balance: exact amount?
4. Check the balance chain: for consecutive rows, does prev_balance + credit - debit = current_balance?
5. For any BROUGHT FORWARD or CLOSING BALANCE: is the value correctly captured?

Set is_valid to true ONLY if you found ZERO errors. Be thorough — this data is used for real payment reconciliation.`

// ── Phase 1: Transcribe ──
phase('Transcribe')
log(`Transcribing ${args.pages.length} pages in parallel`)

const transcriptions = await parallel(
  args.pages.map((pagePath, i) => () =>
    agent(TRANSCRIBE_PROMPT(pagePath, i + 1), {
      label: `transcribe:page-${i + 1}`,
      phase: 'Transcribe',
      schema: TXN_SCHEMA,
    })
  )
)

const transcribedCount = transcriptions.filter(Boolean).reduce((sum, t) => sum + t.transactions.length, 0)
log(`Transcription complete: ${transcribedCount} transactions across ${transcriptions.filter(Boolean).length} pages`)

// ── Phase 2: Adversarial Validation ──
phase('Validate')
log(`Launching adversarial validators for ${args.pages.length} pages`)

const validations = await parallel(
  args.pages.map((pagePath, i) => () => {
    const txn = transcriptions[i]
    if (!txn) return null
    return agent(VALIDATE_PROMPT(pagePath, i + 1, txn), {
      label: `validate:page-${i + 1}`,
      phase: 'Validate',
      schema: VALIDATION_SCHEMA,
    })
  })
)

// ── Combine results ──
const allTxns = []
const pageResults = []

for (let i = 0; i < transcriptions.length; i++) {
  const txn = transcriptions[i]
  const val = validations[i]

  if (!txn) {
    log(`Page ${i + 1}: FAILED — no transcription`)
    pageResults.push({ page: i + 1, status: 'failed', count: 0, errors: [] })
    continue
  }

  const hasErrors = val && !val.is_valid
  const countMismatch = val && val.actual_count !== val.transcribed_count

  if (countMismatch) {
    log(`Page ${i + 1}: ROW COUNT MISMATCH — transcribed ${val.transcribed_count}, validator counted ${val.actual_count}`)
  } else if (hasErrors) {
    log(`Page ${i + 1}: ${val.errors.length} error(s) found by validator`)
  } else {
    log(`Page ${i + 1}: ${txn.transactions.length} transactions — VALIDATED OK`)
  }

  pageResults.push({
    page: i + 1,
    status: hasErrors ? 'errors_found' : 'validated',
    count: txn.transactions.length,
    errors: val ? val.errors : [],
    count_mismatch: countMismatch || false,
    balance_chain_valid: val ? val.balance_chain_valid : null,
    brought_forward: txn.brought_forward || null,
    closing_balance: txn.closing_balance || null,
  })

  // Add transactions with page number and extract sender/ref for prematch compatibility
  for (const t of txn.transactions) {
    const sender = extractSender(t.description)
    const ref = extractRef(t.description)
    allTxns.push({
      date: t.post_date,
      amount: t.credit || t.debit || 0,
      sender: sender,
      ref: ref,
      type: t.credit ? 'credit' : 'debit',
      description: t.description,
      credit: t.credit,
      debit: t.debit,
      balance: t.balance,
      page: i + 1,
    })
  }
}

// Extract sender name from bank statement description
function extractSender(desc) {
  if (!desc) return ''
  // UPI: UPI/CR/<id>/NAME/... or UPI/CR/<id>/NAME ...
  const upi = desc.match(/UPI\/CR\/\d+\/([A-Z][A-Z\s.]+?)(?:\/|\s+[A-Z]\/|\s+\d)/)
  if (upi) return upi[1].trim()
  // IMPS: IMPS/<id>/<code>-NAME/...
  const imps = desc.match(/IMPS\/\d+\/[a-zA-Z]+-XX?\d*-?\s*([A-Z][A-Z\s.]+?)(?:\/|\s+\d)/)
  if (imps) return imps[1].trim()
  // NEFT: NEFT*...*NAME*...
  const neft = desc.match(/\*([A-Z][A-Z\s]+?)\*(?:BA|[A-Z]{2,})/)
  if (neft) return neft[1].trim()
  // SBIY: OF Mr./Mrs./Ms. NAME
  const sbiy = desc.match(/OF (?:Mr\.|Mrs\.|Ms\.)?\s*([A-Z][A-Z\s]+?)(?:\s+AT|\s*$)/)
  if (sbiy) return sbiy[1].trim()
  return ''
}

// Extract bank reference from description
function extractRef(desc) {
  if (!desc) return ''
  const upi = desc.match(/UPI\/CR\/(\d+)\//)
  if (upi) return upi[1]
  const imps = desc.match(/IMPS\/(\d+)\//)
  if (imps) return imps[1]
  const sbiy = desc.match(/(SBIY\d{15,})/)
  if (sbiy) return sbiy[1]
  const neft = desc.match(/NEFT[^A-Z]*([A-Z]{4,}\d{5,})/)
  if (neft) return neft[1]
  return ''
}

const errorPages = pageResults.filter(p => p.status === 'errors_found' || p.count_mismatch)
const totalErrors = errorPages.reduce((sum, p) => sum + p.errors.length, 0)

log(`\nFINAL: ${allTxns.length} transactions extracted. ${errorPages.length} pages with issues, ${totalErrors} total errors.`)

return {
  transactions: allTxns,
  total_count: allTxns.length,
  page_results: pageResults,
  error_pages: errorPages.map(p => p.page),
  total_errors: totalErrors,
  has_issues: errorPages.length > 0,
}
