/**
 * A small PDF writer: A4 pages, text in Helvetica and Helvetica-Bold, lines
 * and filled boxes. Enough for a statement or an invoice, with no dependency.
 *
 * seniordev: the two standard PDF fonts only (WinAnsi). Characters outside it —
 * Kannada or Devanagari dish names, the rupee sign — print as "?" / "Rs".
 * Embedding a Unicode font (e.g. Noto) is the upgrade if menus need them.
 */

// Character widths (per 1000 units of font size) of the standard fonts, ASCII 32..126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
  556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
  260, 334, 584
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833,
  722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611,
  556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389,
  280, 389, 584
];

// WinAnsi bytes for the typographic characters our text actually uses.
const WIN_ANSI: Record<string, number> = {
  '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '•': 0x95, '…': 0x85, '€': 0x80
};

/** Text as WinAnsi bytes (one char per byte), with anything unprintable as "?". */
function encode(text: string): string {
  let out = '';
  for (const ch of text.replace(/₹\s?/g, 'Rs ')) {
    const code = ch.codePointAt(0)!;
    if (WIN_ANSI[ch]) out += String.fromCharCode(WIN_ANSI[ch]);
    else if (code >= 32 && code <= 255 && code !== 127) out += ch;
    else out += '?';
  }
  return out;
}

const escapePdf = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

export type Rgb = [number, number, number];
const rgb = ([r, g, b]: Rgb) => `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: Rgb;
  align?: 'left' | 'right' | 'center';
}

export class SimplePdf {
  readonly width = 595.28;
  readonly height = 841.89;
  private pages: string[][] = [];
  private target = -1;

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
  }

  /** Draw on an earlier page (page numbers are written once the count is known). */
  onPage(index: number, draw: () => void): void {
    this.target = index;
    try {
      draw();
    } finally {
      this.target = -1;
    }
  }

  textWidth(text: string, size = 10, bold = false): number {
    const table = bold ? HELVETICA_BOLD : HELVETICA;
    let units = 0;
    for (const ch of encode(text)) {
      const code = ch.charCodeAt(0);
      units += code >= 32 && code <= 126 ? table[code - 32] : 556;
    }
    return (units * size) / 1000;
  }

  /** `y` is measured from the TOP of the page, to the text's baseline. */
  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const { size = 10, bold = false, color = [23, 19, 19], align = 'left' } = options;
    const w = this.textWidth(value, size, bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    this.current().push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${left.toFixed(2)} ${(this.height - y).toFixed(2)} Td (${escapePdf(encode(value))}) Tj ET`
    );
  }

  /** Breaks `value` into lines no wider than `maxWidth`. */
  wrap(value: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (this.textWidth(next, size, bold) <= maxWidth || !line) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  line(x1: number, y1: number, x2: number, y2: number, color: Rgb = [226, 215, 204], width = 0.75): void {
    this.current().push(
      `${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l S`
    );
  }

  /** A filled box; `y` is its top edge, from the top of the page. */
  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.current().push(`${rgb(color)} rg ${x.toFixed(2)} ${(this.height - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const add = (body: string) => objects.push(body) && objects.length;

    const catalog = add('');
    const pagesId = add('');
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const kids: number[] = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
            `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`
        )
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  private current(): string[] {
    return this.pages[this.target >= 0 ? this.target : this.pages.length - 1];
  }
}
