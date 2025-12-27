import Encoding from 'encoding-japanese';

export interface AaEntry {
  title: string;
  content: string;
}

export type EncodingType = 'AUTO' | 'SJIS' | 'UTF8';
export type FileFormat = 'AST' | 'MLT';

export class AaFileManager {
  
  static async loadFile(file: File, encoding: EncodingType = 'AUTO'): Promise<AaEntry[]> {
    const buffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(buffer);

    let detected = encoding;
    if (encoding === 'AUTO') {
        const det = Encoding.detect(uint8Array);
        detected = (det && typeof det === 'string') ? det as EncodingType : 'SJIS'; 
    }

    const targetEncoding = detected === 'SJIS' ? 'SJIS' : 'UTF8';
    const text = Encoding.convert(uint8Array, {
      to: 'UNICODE',
      from: targetEncoding
    });

    const decodedText = typeof text === 'string' ? text : Encoding.codeToString(text);
    return this.parseText(decodedText);
  }

  static parseText(fullText: string): AaEntry[] {
    // 読み込み時はあらゆる改行コードを \n に統一して処理しやすくする
    const normalized = fullText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // AST形式 ([AA][Title]...) の判定
    if (normalized.indexOf('[AA][') !== -1) {
        const entries: AaEntry[] = [];
        const parts = normalized.split(/\[AA\]\[(.*?)\]\n?/);
        for (let i = 1; i < parts.length; i += 2) {
            const title = parts[i];
            const content = parts[i + 1] || "";
            entries.push({
                title: title!,
                content: this.decodeEntities(content.trimEnd())
            });
        }
        return entries;
    } 
    
    // MLT形式 ([SPLIT]区切り) の判定
    if (normalized.indexOf('[SPLIT]') !== -1) {
        const splits = normalized.split(/\[SPLIT\]\n?/);
        return splits.map((content, i) => ({
            title: `Art ${i + 1}`, 
            content: this.decodeEntities(content.trim())
        })).filter(e => e.content);
    }

    return [{ title: 'Untitled', content: this.decodeEntities(normalized) }];
  }

  /**
   * ファイル保存 (修正版)
   */
  static saveFile(entries: AaEntry[], encoding: EncodingType, format: FileFormat, fileName: string) {
    let rawString = "";

    if (format === 'AST') {
        for (const entry of entries) {
            rawString += `[AA][${entry.title}]\n`;
            rawString += entry.content;
            rawString += "\n\n";
        }
    } else {
        for (let i = 0; i < entries.length; i++) {
            if (i > 0) rawString += "\n[SPLIT]\n";
            rawString += entries[i]!.content;
        }
    }

    // ★修正1: Windows用に改行コードを CRLF (\r\n) に強制変換
    // 内部的には \n で扱っているが、ファイル書き出し時は \r\n にする
    const crlfString = rawString.replace(/\n/g, "\r\n");

    const convertTo = encoding === 'SJIS' ? 'SJIS' : 'UTF8';
    
    // ★修正2: 配列バッファとして変換し、Uint8Arrayとして受け取る
    const encodedData = Encoding.convert(crlfString, {
      to: convertTo,
      from: 'UNICODE',
      type: 'arraybuffer'
    });
    
    let uint8Data = new Uint8Array(encodedData);

    // ★修正3: UTF-8の場合、BOM (Byte Order Mark) を付与する
    // これがないとWindowsのメモ帳はShift-JISやANSIとして誤認し、文字化けする
    if (convertTo === 'UTF8') {
        const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
        const withBom = new Uint8Array(bom.length + uint8Data.length);
        withBom.set(bom);
        withBom.set(uint8Data, bom.length);
        uint8Data = withBom;
    }

    // Blob作成 (Uint8Arrayを渡すことでバイナリとして扱われる)
    const blob = new Blob([uint8Data], { 
        type: encoding === 'SJIS' ? 'text/plain;charset=Shift_JIS' : 'text/plain;charset=UTF-8' 
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  static decodeEntities(text: string): string {
    if (!text.includes('&')) return text;
    return text.replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
               .replace(/&#x([0-9a-f]+);/yi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
               .replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>');
  }
}