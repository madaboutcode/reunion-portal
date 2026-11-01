// Parses fixed-width SBI bank statement text exports into structured transactions.

export interface ParsedStatement {
  accountName: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
  openingBalance: number; // paise
  closingBalance: number; // paise
  transactions: ParsedTransaction[];
}

export interface ParsedTransaction {
  txnDate: string;
  txnDateIso: string;
  valueDate: string;
  description: string;
  refNo: string | null;
  branchCode: string | null;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  txnType: 'credit' | 'debit';
  txnHash: string;
}

const COL_VALUE_DATE = 13;
const COL_DESCRIPTION = 36;
const COL_REF_NO = 108;
const COL_BRANCH_CODE = 148;
const COL_DEBIT = 172;
const COL_CREDIT = 191;
const MIN_LINE_LENGTH = 230;
// Debit/Credit/Balance are right-aligned numeric columns: a wider number
// shifts its start position leftward, so a rigid slice(start, nextStart)
// can truncate digits. Instead we tokenize the tail of the line (from the
// branch code column onward) and classify each amount token by comparing
// its start offset to the midpoint between the declared column labels.
const DEBIT_CREDIT_THRESHOLD = (COL_DEBIT + COL_CREDIT) / 2;

const TXN_LINE_RE = /^\s*\d{1,2} [A-Za-z]{3} \d{4}/;
const TAB_HEADER_FIELDS = [
  'Txn Date',
  'Value Date',
  'Description',
  'Ref No./Cheque No.',
  'Branch Code',
  'Debit',
  'Credit',
  'Balance',
];

function padLine(line: string): string {
  return line.length >= MIN_LINE_LENGTH
    ? line
    : line + ' '.repeat(MIN_LINE_LENGTH - line.length);
}

function parseAmountToPaise(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  return Math.round(parseFloat(cleaned) * 100);
}

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

function toIsoDate(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length !== 3) return '1970-01-01';
  const [day, mon, year] = parts;
  return `${year}-${MONTHS[mon] ?? '01'}-${day.padStart(2, '0')}`;
}

async function hashTransaction(txnDate: string, description: string, amount: string): Promise<string> {
  const input = `${txnDate}|${description}|${amount}`;
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractHeaderValue(line: string, label: RegExp): string | null {
  const match = line.match(label);
  if (!match) return null;
  return match[1].trim();
}

function parseHeader(lines: string[]): {
  accountName: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
  closingBalance: number | null;
} {
  let accountName = '';
  let accountNumber = '';
  let startDate = '';
  let endDate = '';
  let openingBalance = 0;
  let closingBalance: number | null = null;

  for (const line of lines) {
    const name = extractHeaderValue(line, /^Account Name:\s*(.*)$/i);
    if (name !== null) accountName = name;

    const acctNo = extractHeaderValue(line, /^Account (?:No\.?|Number):\s*(.*)$/i);
    if (acctNo !== null) accountNumber = acctNo;

    const start = extractHeaderValue(line, /^Start Date:\s*(.*)$/i);
    if (start !== null) startDate = start;

    const end = extractHeaderValue(line, /^End Date:\s*(.*)$/i);
    if (end !== null) endDate = end;

    const opening = line.match(/^Opening Balance as on .*?\s{2,}([\d,]+\.\d{2})\s*$/i);
    if (opening) openingBalance = parseAmountToPaise(opening[1]);

    const closing = line.match(/^Closing Balance(?: as on .*)?:?\s{2,}([\d,]+\.\d{2})\s*$/i);
    if (closing) closingBalance = parseAmountToPaise(closing[1]);
  }

  return { accountName, accountNumber, startDate, endDate, openingBalance, closingBalance };
}

function tokenizeTail(tail: string, offset: number): { value: string; start: number }[] {
  const tokens: { value: string; start: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) !== null) {
    tokens.push({ value: m[0], start: offset + m.index });
  }
  return tokens;
}

async function parseTransactionLine(line: string): Promise<ParsedTransaction | null> {
  if (!TXN_LINE_RE.test(line)) return null;

  const padded = padLine(line);

  const txnDate = padded.slice(0, COL_VALUE_DATE).trim();
  const valueDate = padded.slice(COL_VALUE_DATE, COL_DESCRIPTION).trim();
  const description = padded.slice(COL_DESCRIPTION, COL_REF_NO).trim();
  const refNoRaw = padded.slice(COL_REF_NO, COL_BRANCH_CODE).trim();
  const refNo = refNoRaw || null;

  const tail = padded.slice(COL_BRANCH_CODE);
  const tokens = tokenizeTail(tail, COL_BRANCH_CODE);

  let branchCode: string | null = null;
  let debitRaw = '';
  let creditRaw = '';
  let balanceRaw = '';

  if (tokens.length > 0) {
    branchCode = tokens[0].value;
    const balanceToken = tokens[tokens.length - 1];
    balanceRaw = balanceToken.value;

    const amountTokens = tokens.slice(1, tokens.length - 1);
    for (const t of amountTokens) {
      if (t.start < DEBIT_CREDIT_THRESHOLD) {
        debitRaw = t.value;
      } else {
        creditRaw = t.value;
      }
    }
  }

  const debitPaise = parseAmountToPaise(debitRaw);
  const creditPaise = parseAmountToPaise(creditRaw);
  const balancePaise = parseAmountToPaise(balanceRaw);

  const txnType: 'credit' | 'debit' = creditRaw ? 'credit' : 'debit';
  const amountRaw = (txnType === 'credit' ? creditRaw : debitRaw).replace(/,/g, '');

  const txnHash = await hashTransaction(txnDate, description, amountRaw);

  return {
    txnDate,
    txnDateIso: toIsoDate(txnDate),
    valueDate,
    description,
    refNo,
    branchCode,
    debitPaise,
    creditPaise,
    balancePaise,
    txnType,
    txnHash,
  };
}

function normalizeTabDescription(description: string): string {
  return description
    .replace(/-{2,}\d+$/, '')
    .replace(/-+$/, '')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTabHeader(line: string): boolean {
  const fields = line.split('\t').map((field) => field.trim());
  return TAB_HEADER_FIELDS.every((field, index) => fields[index] === field);
}

function parseTabHeader(lines: string[]): {
  accountName: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
  openingBalance: number;
} {
  let accountName = '';
  let accountNumber = '';
  let startDate = '';
  let endDate = '';
  let openingBalance = 0;

  for (const line of lines) {
    const fields = line.split('\t');
    if (fields.length < 2) continue;

    const label = fields[0].trim();
    const value = fields.slice(1).join('\t').trim();

    if (/^Account Name\s*:/i.test(label)) accountName = value;
    if (/^Account (?:No\.?|Number)\s*:/i.test(label)) accountNumber = value;
    if (/^Start Date\s*:/i.test(label)) startDate = value;
    if (/^End Date\s*:/i.test(label)) endDate = value;
    if (/^Opening Balance as on .*:/i.test(label)) openingBalance = parseAmountToPaise(value);
  }

  return { accountName, accountNumber, startDate, endDate, openingBalance };
}

async function parseTabTransactionLine(line: string): Promise<ParsedTransaction | null> {
  if (!TXN_LINE_RE.test(line)) return null;

  const fields = line.split('\t');
  if (fields.length < TAB_HEADER_FIELDS.length) return null;

  const [txnDateRaw, valueDateRaw, descriptionRaw, refNoRaw, branchCodeRaw, debitRaw, creditRaw, balanceRaw] = fields;
  const txnDate = txnDateRaw.trim();
  const valueDate = valueDateRaw.trim();
  const description = normalizeTabDescription(descriptionRaw);
  const refNo = refNoRaw.trim() || null;
  const branchCode = branchCodeRaw.trim() || null;
  const debit = debitRaw.trim();
  const credit = creditRaw.trim();
  const debitPaise = parseAmountToPaise(debit);
  const creditPaise = parseAmountToPaise(credit);
  const balancePaise = parseAmountToPaise(balanceRaw);
  const txnType: 'credit' | 'debit' = credit ? 'credit' : 'debit';
  const amountRaw = (txnType === 'credit' ? credit : debit).replace(/,/g, '');
  const txnHash = await hashTransaction(txnDate, description, amountRaw);

  return {
    txnDate,
    txnDateIso: toIsoDate(txnDate),
    valueDate,
    description,
    refNo,
    branchCode,
    debitPaise,
    creditPaise,
    balancePaise,
    txnType,
    txnHash,
  };
}

async function parseTabDelimitedStatement(lines: string[], headerIndex: number): Promise<ParsedStatement> {
  const header = parseTabHeader(lines.slice(0, headerIndex));
  const transactions: ParsedTransaction[] = [];

  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    if (line.startsWith('**This is a computer generated statement')) break;

    const txn = await parseTabTransactionLine(line);
    if (txn) transactions.push(txn);
  }

  return {
    accountName: header.accountName,
    accountNumber: header.accountNumber,
    startDate: header.startDate,
    endDate: header.endDate,
    openingBalance: header.openingBalance,
    closingBalance: transactions.length > 0 ? transactions[transactions.length - 1].balancePaise : 0,
    transactions,
  };
}

export async function parseSbiStatement(text: string): Promise<ParsedStatement> {
  const lines = text.split(/\r?\n/);
  const tabHeaderIndex = lines.findIndex(isTabHeader);
  if (tabHeaderIndex >= 0) return parseTabDelimitedStatement(lines, tabHeaderIndex);

  const headerLines = lines.slice(0, 21);
  const header = parseHeader(headerLines);

  const transactions: ParsedTransaction[] = [];
  for (const line of lines.slice(21)) {
    const txn = await parseTransactionLine(line);
    if (txn) transactions.push(txn);
  }

  const closingBalance =
    header.closingBalance ?? (transactions.length > 0 ? transactions[transactions.length - 1].balancePaise : 0);

  return {
    accountName: header.accountName,
    accountNumber: header.accountNumber,
    startDate: header.startDate,
    endDate: header.endDate,
    openingBalance: header.openingBalance,
    closingBalance,
    transactions,
  };
}
