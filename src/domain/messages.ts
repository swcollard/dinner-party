/** Returns an E.164-style number, or null. Ten digits are taken as a US number. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (input.trim().startsWith("+")) return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** iOS and Android disagree on how to address several recipients. */
export function smsUri(phones: string[], body: string, userAgent = ""): string {
  const text = encodeURIComponent(body);
  if (phones.length > 1 && /iPhone|iPad|iPod|Macintosh/.test(userAgent)) {
    return `sms:/open?addresses=${phones.join(",")}&body=${text}`;
  }
  return `sms:${phones.join(",")}?&body=${text}`;
}

export function whatsappUri(body: string): string {
  return `https://wa.me/?text=${encodeURIComponent(body)}`;
}
