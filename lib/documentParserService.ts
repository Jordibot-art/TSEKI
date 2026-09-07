import * as FileSystem from "expo-file-system/legacy";
import JSZip from "jszip";

export type SupportedDocType = "pdf" | "docx" | "doc" | "pptx" | "ppt" | "txt";

export interface ParsedDocument {
    type: SupportedDocType;
    name: string;
    mimeType?: string;
    text?: string;
    base64?: string;
    summaryText: string;
}

export interface DocBadgeInfo {
    label: string;
    icon: string;
    color: string;
    bgColor: string;
}

/**
 * Returns badge styling and icon according to the detected file type.
 */
export function getDocBadgeInfo(type: SupportedDocType): DocBadgeInfo {
    switch (type) {
        case "pdf":
            return { label: "PDF", icon: "document-text", color: "#DC2626", bgColor: "#FEE2E2" };
        case "docx":
            return { label: "DOCX", icon: "document-text-outline", color: "#2563EB", bgColor: "#DBEAFE" };
        case "doc":
            return { label: "DOC", icon: "document-text-outline", color: "#1D4ED8", bgColor: "#EFF6FF" };
        case "pptx":
            return { label: "PPTX", icon: "easel-outline", color: "#EA580C", bgColor: "#FFEDD5" };
        case "ppt":
            return { label: "PPT", icon: "easel-outline", color: "#C2410C", bgColor: "#FFF7ED" };
        case "txt":
        default:
            return { label: "TXT", icon: "reader-outline", color: "#4B5563", bgColor: "#F3F4F6" };
    }
}

/**
 * Identifies document type by extension or MIME type.
 */
export function detectDocType(fileName: string, mimeType?: string): SupportedDocType {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const mime = (mimeType || "").toLowerCase();

    if (ext === "pdf" || mime.includes("pdf")) return "pdf";
    if (ext === "docx" || mime.includes("wordprocessingml")) return "docx";
    if (ext === "doc" || mime.includes("msword")) return "doc";
    if (ext === "pptx" || mime.includes("presentationml")) return "pptx";
    if (ext === "ppt" || mime.includes("powerpoint")) return "ppt";
    if (ext === "txt" || ext === "md" || ext === "csv" || ext === "tsv" || ext === "rtf" || mime.startsWith("text/")) {
        return "txt";
    }

    // Default fallback based on common patterns
    if (ext.includes("doc")) return "docx";
    if (ext.includes("ppt")) return "pptx";
    return "txt";
}

/**
 * Decodes XML entities into standard readable characters.
 */
function decodeXmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&(?:apos|#39|#x27);/g, "'")
        .replace(/&#(\d+);/g, (_, num) => {
            const code = parseInt(num, 10);
            return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : "";
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : "";
        });
}

/**
 * Extracts clean paragraphs of text from Word DOCX XML.
 */
export async function extractTextFromDocxZip(zip: JSZip): Promise<string> {
    const docFile = zip.file("word/document.xml") || zip.file(/^word\/document\.xml$/i)[0];
    if (!docFile) {
        throw new Error("Invalid DOCX file: word/document.xml not found.");
    }

    const xml = await docFile.async("text");

    // Replace line breaks and tabs
    const formatted = xml
        .replace(/<w:br[^>]*\/?>/gi, "\n")
        .replace(/<w:cr[^>]*\/?>/gi, "\n")
        .replace(/<w:tab[^>]*\/?>/gi, "\t");

    const paragraphs: string[] = [];
    const pRegex = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/gi;
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(formatted)) !== null) {
        const pContent = pMatch[1];
        const tRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/gi;
        let tMatch: RegExpExecArray | null;
        let pText = "";

        while ((tMatch = tRegex.exec(pContent)) !== null) {
            pText += tMatch[1];
        }

        const cleaned = decodeXmlEntities(pText.trim());
        if (cleaned.length > 0) {
            paragraphs.push(cleaned);
        }
    }

    return paragraphs.join("\n\n");
}

/**
 * Extracts slide-by-slide text from PowerPoint PPTX XML.
 */
export async function extractTextFromPptxZip(zip: JSZip): Promise<string> {
    const slideFiles = Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
            const matchA = a.match(/\d+/);
            const matchB = b.match(/\d+/);
            const numA = matchA ? parseInt(matchA[0], 10) : 0;
            const numB = matchB ? parseInt(matchB[0], 10) : 0;
            return numA - numB;
        });

    if (slideFiles.length === 0) {
        throw new Error("Invalid PPTX file: No slides found in ppt/slides/.");
    }

    const slideSections: string[] = [];

    for (const slideFileName of slideFiles) {
        const file = zip.file(slideFileName);
        if (!file) continue;

        const xml = await file.async("text");
        const numMatch = slideFileName.match(/\d+/);
        const slideIndex = numMatch ? numMatch[0] : slideSections.length + 1;

        const paragraphs: string[] = [];
        const pRegex = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/gi;
        let pMatch: RegExpExecArray | null;

        while ((pMatch = pRegex.exec(xml)) !== null) {
            const pContent = pMatch[1];
            const tRegex = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/gi;
            let tMatch: RegExpExecArray | null;
            let pText = "";

            while ((tMatch = tRegex.exec(pContent)) !== null) {
                pText += tMatch[1];
            }

            const cleaned = decodeXmlEntities(pText.trim());
            if (cleaned.length > 0) {
                paragraphs.push(cleaned);
            }
        }

        if (paragraphs.length > 0) {
            slideSections.push(`--- Slide ${slideIndex} ---\n${paragraphs.join("\n")}`);
        }
    }

    return slideSections.join("\n\n");
}

/**
 * Extracts readable ASCII & UTF-16LE text from binary files (e.g. legacy .doc or .ppt).
 */
export function extractStringsFromBinary(base64Data: string): string {
    // Decode base64 to binary string
    const binaryStr = typeof atob === "function" ? atob(base64Data) : Buffer.from(base64Data, "base64").toString("binary");
    const len = binaryStr.length;
    const pieces: string[] = [];

    // 1. ASCII string extraction (runs >= 4 chars)
    let curAscii = "";
    for (let i = 0; i < len; i++) {
        const code = binaryStr.charCodeAt(i);
        if (code >= 32 && code <= 126) {
            curAscii += binaryStr[i];
        } else {
            if (curAscii.length >= 4) {
                pieces.push(curAscii.trim());
            }
            curAscii = "";
        }
    }
    if (curAscii.length >= 4) pieces.push(curAscii.trim());

    // 2. UTF-16LE string extraction (common in MS Office 97-2003 binary formats)
    let curUtf16 = "";
    for (let i = 0; i < len - 1; i += 2) {
        const low = binaryStr.charCodeAt(i);
        const high = binaryStr.charCodeAt(i + 1);
        if (high === 0 && low >= 32 && low <= 126) {
            curUtf16 += String.fromCharCode(low);
        } else {
            if (curUtf16.length >= 4) {
                pieces.push(curUtf16.trim());
            }
            curUtf16 = "";
        }
    }
    if (curUtf16.length >= 4) pieces.push(curUtf16.trim());

    // Filter out common binary OLE headers
    const filtered = pieces.filter((t) =>
        t.length >= 3 &&
        !/^(?:Root Entry|WordDocument|SummaryInformation|DocumentSummaryInformation|CompObj|Current User|Table|Data)$/i.test(t)
    );

    return Array.from(new Set(filtered)).join("\n");
}

const MAX_CHAR_LIMIT = 400000; // ~80,000 - 100,000 words to prevent mobile memory strain

/**
 * Parses any attached file (PDF, DOCX, DOC, PPTX, PPT, TXT) into a format
 * ready for processing by the Gemini AI assessment generator.
 */
export async function parseDocumentFile(file: {
    uri: string;
    name: string;
    mimeType?: string;
}): Promise<ParsedDocument> {
    const detectedType = detectDocType(file.name, file.mimeType);

    // ── PDF Handling ──────────────────────────────────────────────────────────
    if (detectedType === "pdf") {
        const base64 = await FileSystem.readAsStringAsync(file.uri, {
            encoding: "base64",
        });

        if (!base64 || base64.trim().length === 0) {
            throw new Error(`The PDF file "${file.name}" appears to be empty.`);
        }

        return {
            type: "pdf",
            name: file.name,
            mimeType: "application/pdf",
            base64,
            summaryText: `PDF Document: ${file.name}`,
        };
    }

    // ── Plain Text / Markdown / CSV ───────────────────────────────────────────
    if (detectedType === "txt") {
        let text = await FileSystem.readAsStringAsync(file.uri, {
            encoding: "utf8",
        });

        text = text.trim();
        if (text.length < 20) {
            throw new Error(
                `The text file "${file.name}" is too short or empty to generate an assessment.`
            );
        }

        if (text.length > MAX_CHAR_LIMIT) {
            text = text.slice(0, MAX_CHAR_LIMIT) + "\n\n[Note: Content truncated to first 400,000 characters for quiz generation]";
        }

        return {
            type: "txt",
            name: file.name,
            mimeType: "text/plain",
            text,
            summaryText: `Text file (${text.split(/\s+/).length} words)`,
        };
    }

    // ── DOCX / PPTX / DOC / PPT ───────────────────────────────────────────────
    const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: "base64",
    });

    if (!base64 || base64.trim().length === 0) {
        throw new Error(`The file "${file.name}" appears to be empty.`);
    }

    let extractedText = "";

    // Attempt ZIP extraction first (DOCX & PPTX are standard ZIP archives)
    try {
        const zip = await JSZip.loadAsync(base64, { base64: true });

        if (detectedType === "docx" || detectedType === "doc") {
            extractedText = await extractTextFromDocxZip(zip);
        } else if (detectedType === "pptx" || detectedType === "ppt") {
            extractedText = await extractTextFromPptxZip(zip);
        } else {
            // Try DOCX then PPTX
            try {
                extractedText = await extractTextFromDocxZip(zip);
            } catch {
                extractedText = await extractTextFromPptxZip(zip);
            }
        }
    } catch {
        // If JSZip fails (e.g. legacy binary .doc or .ppt), attempt binary text extraction
        extractedText = extractStringsFromBinary(base64);
    }

    extractedText = extractedText.trim();

    if (extractedText.length < 20) {
        throw new Error(
            `Could not extract readable text from "${file.name}". If this document consists entirely of scanned images or pictures without editable text, please convert or export it as a PDF.`
        );
    }

    if (extractedText.length > MAX_CHAR_LIMIT) {
        extractedText = extractedText.slice(0, MAX_CHAR_LIMIT) + "\n\n[Note: Content truncated to first 400,000 characters for quiz generation]";
    }

    const wordCount = extractedText.split(/\s+/).filter(Boolean).length;
    return {
        type: detectedType,
        name: file.name,
        mimeType: file.mimeType,
        text: extractedText,
        summaryText: `${detectedType.toUpperCase()} Document (${wordCount} words extracted)`,
    };
}
