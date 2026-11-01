import { REG_CODE_PREFIX } from "./reg-code.ts";
export interface ParsedBankDescription {
  type: 'UPI' | 'IMPS' | 'NEFT' | 'SBI' | 'OTHER';
  name: string | null;
  remark: string | null;
  txnRef: string | null;
  raw: string;
}

export function parseBankDescription(raw: string): ParsedBankDescription {
  const desc = raw.trim().replace(/-$/, '').trim();

  // UPI: BY TRANSFER-UPI/CR/{txn_id}/{name}/{bank}/{upi_id}/{remark}
  const upi = desc.match(/BY TRANSFER-UPI\/CR\/(\d+)\/([^/]+)\/[A-Z]{4}\/[^/]*\/?(.*)/);
  if (upi) {
    const upiRemark = upi[3].trim();
  const cleanRemark = upiRemark && !/^(UPI|From|Payme|Sent|Paid|Bill Pay)$/i.test(upiRemark) ? upiRemark : null;
  return { type: 'UPI', name: upi[2].trim() || null, remark: cleanRemark, txnRef: upi[1], raw };
  }

  // IMPS: BY TRANSFER-IMPS/{txn_id}/{bank}-XX{digits}-{name}/{remark}
  const imps = desc.match(/BY TRANSFER-IMPS\/(\d+)\/[a-zA-Z]+-XX\w+-([^/]+)\/?(.*)/i);
  if (imps) {
    const impsRemark = imps[3].trim();
    const cleanImps = impsRemark && !/^(IMPS|IMPS Tran|Quick Pay)$/i.test(impsRemark) ? impsRemark : null;
    return { type: 'IMPS', name: imps[2].trim() || null, remark: cleanImps, txnRef: imps[1], raw };
  }

  // NEFT (BY TRANSFER): BY TRANSFER-NEFT*{ifsc}*{ref}*{name}*{batch}
  const neft = desc.match(/BY TRANSFER-NEFT\*[^*]+\*([^*]+)\*([^*]+)\*?(.*)/);
  if (neft) {
    const neftRemark = neft[3].trim();
    const cleanNeft = neftRemark && !/^(BAT|BATCHID)$/i.test(neftRemark) ? neftRemark : null;
    return { type: 'NEFT', name: neft[2].trim() || null, remark: cleanNeft, txnRef: neft[1], raw };
  }

  // CHQ NEFT: CHQ TRANSFER-NEFT UTR NO: {utr} {name}
  const chq = desc.match(/CHQ TRANSFER-NEFT UTR NO:\s*(\S+)\s+(.*)/);
  if (chq) {
    return { type: 'NEFT', name: chq[2].trim() || null, remark: null, txnRef: chq[1], raw };
  }

  // SBI: BY TRANSFER-SBIY{ref}/{type}/{remark}
  const sbi = desc.match(/BY TRANSFER-SBIY(\d+)\/[MP]\/(.*)/);
  if (sbi) {
    const rem = sbi[2].trim();
    const nameAfterSmrt = rem.match(new RegExp(`^${REG_CODE_PREFIX}\\w+\\s+(.*)`));
    return {
      type: 'SBI',
      name: nameAfterSmrt ? nameAfterSmrt[1].trim() || null : null,
      remark: rem || null,
      txnRef: sbi[1],
      raw,
    };
  }

  return { type: 'OTHER', name: null, remark: null, txnRef: null, raw };
}
