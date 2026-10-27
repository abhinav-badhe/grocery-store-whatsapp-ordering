import type {
  ParsedGroceryItem,
  GroceryListParseResult,
  ParseConfidence,
  CanonicalUnit,
} from '@grocery/api-contracts';
import { ParsedGroceryItemSchema, GroceryListParseResultSchema } from '@grocery/api-contracts';

/**
 * Curated list of well-known grocery and FMCG brand names for deterministic recognition.
 * Ordered with multi-word brands first to prevent partial token prefix collisions (e.g. 'Surf Excel' before 'Surf').
 */
const KNOWN_BRANDS: Array<{ canonical: string; pattern: RegExp }> = [
  { canonical: 'Hair and Care', pattern: /\b(?:hair\s*(?:&|and)\s*care)\b/i },
  { canonical: 'Surf Excel', pattern: /\b(?:surf\s*excel)\b/i },
  { canonical: 'Mother Dairy', pattern: /\b(?:mother\s*dairy)\b/i },
  { canonical: 'Red Label', pattern: /\b(?:red\s*label)\b/i },
  { canonical: 'Taj Mahal', pattern: /\b(?:taj\s*mahal)\b/i },
  { canonical: 'Good Day', pattern: /\b(?:good\s*day)\b/i },
  { canonical: 'Marie Gold', pattern: /\b(?:marie\s*gold)\b/i },
  { canonical: 'Close Up', pattern: /\b(?:close\s*up)\b/i },
  { canonical: 'Parle-G', pattern: /\b(?:parle[- ]?g)\b/i },
  { canonical: 'Amul', pattern: /\b(?:amul)\b/i },
  { canonical: 'Lux', pattern: /\b(?:lux)\b/i },
  { canonical: 'Tata', pattern: /\b(?:tata)\b/i },
  { canonical: 'Colgate', pattern: /\b(?:colgate)\b/i },
  { canonical: 'Aashirvaad', pattern: /\b(?:aashirvaad|ashirwad|aashirwad)\b/i },
  { canonical: 'Fortune', pattern: /\b(?:fortune)\b/i },
  { canonical: 'Dettol', pattern: /\b(?:dettol)\b/i },
  { canonical: 'Britannia', pattern: /\b(?:britannia)\b/i },
  { canonical: 'Parle', pattern: /\b(?:parle)\b/i },
  { canonical: 'Maggi', pattern: /\b(?:maggi)\b/i },
  { canonical: 'Nestle', pattern: /\b(?:nestle)\b/i },
  { canonical: 'Kissan', pattern: /\b(?:kissan)\b/i },
  { canonical: 'Haldiram', pattern: /\b(?:haldiram'?s?)\b/i },
  { canonical: 'Dabur', pattern: /\b(?:dabur)\b/i },
  { canonical: 'Patanjali', pattern: /\b(?:patanjali)\b/i },
  { canonical: 'Sunfeast', pattern: /\b(?:sunfeast)\b/i },
  { canonical: 'Horlicks', pattern: /\b(?:horlicks)\b/i },
  { canonical: 'Bournvita', pattern: /\b(?:bournvita)\b/i },
  { canonical: 'Saffola', pattern: /\b(?:saffola)\b/i },
  { canonical: 'Dove', pattern: /\b(?:dove)\b/i },
  { canonical: 'Lifebuoy', pattern: /\b(?:lifebuoy)\b/i },
  { canonical: 'Pepsodent', pattern: /\b(?:pepsodent)\b/i },
  { canonical: 'Vim', pattern: /\b(?:vim)\b/i },
  { canonical: 'Rin', pattern: /\b(?:rin)\b/i },
  { canonical: 'Ariel', pattern: /\b(?:ariel)\b/i },
  { canonical: 'Tide', pattern: /\b(?:tide)\b/i },
  { canonical: 'Lipton', pattern: /\b(?:lipton)\b/i },
  { canonical: 'Bru', pattern: /\b(?:bru)\b/i },
  { canonical: 'Nescafe', pattern: /\b(?:nescafe)\b/i },
  { canonical: 'Everest', pattern: /\b(?:everest)\b/i },
  { canonical: 'MDH', pattern: /\b(?:mdh)\b/i },
  { canonical: 'Catch', pattern: /\b(?:catch)\b/i },
  { canonical: 'Cadbury', pattern: /\b(?:cadbury)\b/i },
  { canonical: 'Oreo', pattern: /\b(?:oreo)\b/i },
  { canonical: 'Lays', pattern: /\b(?:lays|lay'?s)\b/i },
  { canonical: 'Kurkure', pattern: /\b(?:kurkure)\b/i },
  { canonical: 'Bingo', pattern: /\b(?:bingo)\b/i },
];

/**
 * Categorical heuristics for detecting dimension incompatibility (Mass vs Volume).
 * Rule: Mass normalizes strictly to mass; Volume normalizes strictly to volume.
 * Never silently convert between mass and volume.
 */
const LIQUID_PRODUCT_KEYWORDS = [
  'shampoo',
  'oil',
  'syrup',
  'lotion',
  'juice',
  'soda',
  'drink',
  'beverage',
  'sauce',
  'vinegar',
  'liquid',
  'wash',
  'cleaner',
  'water',
  'milk',
];

const SOLID_PRODUCT_KEYWORDS = [
  'sugar',
  'salt',
  'atta',
  'flour',
  'rice',
  'dal',
  'wheat',
  'maida',
  'besan',
  'sooji',
  'rava',
  'pulse',
  'pulses',
  'spice',
  'spices',
  'powder',
  'butter',
  'paneer',
  'cheese',
];

interface IntermediateExtraction {
  brand: string | null;
  productName: string;
  originalQuantity: number | null;
  originalUnit: string | null;
  normalizedQuantity: number | null;
  normalizedUnit: CanonicalUnit | null;
  requestedPackCount: number | null;
  packageSize: { amount: number; unit: string } | null;
  confidence: ParseConfidence;
  ambiguityReasons: string[];
}

/**
 * Deterministic Grocery List Parser.
 *
 * Implements architectural requirements:
 * 1. Strict separation of original customer text, requested pack count, and package size.
 * 2. Dimension safety: Mass normalizes strictly to Mass (g <-> kg), Volume strictly to Volume (ml <-> l).
 * 3. Flagging of incompatible dimensions (e.g. shampoo in grams or sugar in ml) without silent conversion.
 * 4. Deterministic brand extraction, noise reduction, and ambiguity classification.
 */
export class DeterministicGroceryParser {
  /**
   * Parse a raw natural language WhatsApp message into structured grocery items.
   */
  public parse(rawMessage: string): GroceryListParseResult {
    if (!rawMessage || typeof rawMessage !== 'string' || !rawMessage.trim()) {
      return GroceryListParseResultSchema.parse({
        originalMessage: rawMessage || '',
        items: [],
        hasAmbiguity: false,
        unparsedLines: [],
      });
    }

    const lines = this.splitIntoItemLines(rawMessage);
    const parsedItems: ParsedGroceryItem[] = [];
    const unparsedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      // Filter out conversational greetings, list headers, or closings without grocery intent
      if (this.isConversationalMeta(trimmed)) {
        continue;
      }

      try {
        const item = this.parseSingleItemLine(trimmed);
        parsedItems.push(ParsedGroceryItemSchema.parse(item));
      } catch {
        unparsedLines.push(trimmed);
      }
    }

    const hasAmbiguity = parsedItems.some(
      (item) => item.confidence === 'AMBIGUOUS' || item.confidence === 'INCOMPATIBLE',
    );

    return GroceryListParseResultSchema.parse({
      originalMessage: rawMessage,
      items: parsedItems,
      hasAmbiguity,
      unparsedLines,
    });
  }

  /**
   * Splits multi-line messages, bulleted lists, and comma-delimited items into distinct item strings.
   */
  private splitIntoItemLines(text: string): string[] {
    // Standardize line breaks
    const rawLines = text.split(/\r?\n/);
    const itemLines: string[] = [];

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      // Check if line contains numbered/bulleted prefixes (e.g. "1.", "1)", "-", "*")
      const strippedPrefix = line.replace(/^\s*(?:[\d]+[.)\-:]|[-*•])\s*/, '').trim();

      // If line contains multiple comma-separated items (e.g., "1kg sugar, 500ml milk, 2 soaps")
      // Split only if commas separate distinct items, preserving numeric decimals like 1.5
      if (this.isCommaSeparatedList(strippedPrefix)) {
        const parts = strippedPrefix.split(/\s*,\s*/);
        for (const p of parts) {
          if (p.trim()) {
            itemLines.push(p.trim());
          }
        }
      } else {
        itemLines.push(strippedPrefix);
      }
    }

    return itemLines;
  }

  private isCommaSeparatedList(text: string): boolean {
    if (!text.includes(',')) {
      return false;
    }
    // Prevent splitting numbers with commas like 1,000
    if (/^\d+,\d+/.test(text)) {
      return false;
    }
    // Check if multiple tokens follow the comma
    const parts = text.split(/\s*,\s*/);
    return parts.length > 1 && parts.every((p) => p.trim().length > 0);
  }

  private isConversationalMeta(line: string): boolean {
    const trimmed = line.replace(/[!.,:;]+$/, '').trim();
    const metaRegex =
      /^(?:hi|hello|hey|namaste|good\s+(?:morning|evening|afternoon)|thank\s*(?:you|s)?|thx|thanks|please\s+send|send\s+me|deliver\s+to|here\s+is\s+(?:my\s+)?(?:grocery\s+)?(?:order|list)|my\s+order\s+is|grocery\s+list)\b/i;
    // Only consider it pure conversational meta if it doesn't also contain grocery units or numbers
    if (metaRegex.test(trimmed)) {
      const hasQuantities = /\b(?:\d+|kg|g|gm|ml|l|ltr|pack|packet|bar|piece)\b/i.test(trimmed);
      if (!hasQuantities) {
        return true;
      }
    }
    // Also ignore short closing gratitude phrases like "thank you", "thanks a lot"
    if (/^(?:thank\s*(?:you|s)?|thanks\s+a\s+lot|thx)$/i.test(trimmed)) {
      return true;
    }
    return false;
  }

  /**
   * Parse a single item line with strict quantity, unit, and brand extraction.
   */
  public parseSingleItemLine(rawText: string): ParsedGroceryItem {
    let workingText = rawText;
    const ambiguityReasons: string[] = [];

    // 1. Extract known brand
    let extractedBrand: string | null = null;
    for (const brandDef of KNOWN_BRANDS) {
      if (brandDef.pattern.test(workingText)) {
        extractedBrand = brandDef.canonical;
        workingText = workingText.replace(brandDef.pattern, ' ').trim();
        break;
      }
    }

    // 2. Extract requested pack count & package size
    // e.g. "2 packs of 500g butter", "2 pack amul butter 500g", "3 packets of 1kg sugar"
    let requestedPackCount: number | null = null;
    let packageSize: { amount: number; unit: string } | null = null;
    let originalQuantity: number | null = null;
    let originalUnit: string | null = null;
    let normalizedQuantity: number | null = null;
    let normalizedUnit: CanonicalUnit | null = null;

    // Pattern 1: Multi-pack with embedded package size: "2 packs of 500g", "2 x 500g", "2 packets 500 gm"
    const multiPackWithSizeRegex =
      /\b(\d+)\s*(?:packs?|packets?|pouches?|boxes?|bags?|x)\s*(?:of|\*|x)?\s*(\d+(?:\.\d+)?)\s*(kgs?|kg|kilo|kilograms?|gms?|gm|g|grams?|mls?|ml|millilitres?|milliliters?|ltrs?|ltr|lt|litres?|liters?|l)\b/i;
    const multiPackMatch = workingText.match(multiPackWithSizeRegex);

    // Pattern 2: Package size before count: "500g x 2", "500 ml * 3"
    const sizeWithMultiPackRegex =
      /\b(\d+(?:\.\d+)?)\s*(kgs?|kg|kilo|kilograms?|gms?|gm|g|grams?|mls?|ml|millilitres?|milliliters?|ltrs?|ltr|lt|litres?|liters?|l)\s*(?:x|\*)\s*(\d+)\b/i;
    const sizeMultiMatch = workingText.match(sizeWithMultiPackRegex);

    // Pattern 3: Discrete count: "2 bars of Lux soap", "2 bars", "3 pieces", "4 bottles", "2 cans"
    const discreteCountRegex =
      /\b(\d+)\s*(?:bars?|pieces?|pcs?|bottles?|cans?|pouches?|packets?|packs?)\s*(?:of)?\b/i;
    const discreteMatch = workingText.match(discreteCountRegex);

    // Pattern 4: Standard single mass/volume unit: "1kg", "500g", "500ml", "1.5 ltr"
    const singleMeasurementRegex =
      /\b(\d+(?:\.\d+)?)\s*(kgs?|kg|kilo|kilograms?|gms?|gm|g|grams?|mls?|ml|millilitres?|milliliters?|ltrs?|ltr|lt|litres?|liters?|l)\b/i;
    const singleMatch = workingText.match(singleMeasurementRegex);

    if (multiPackMatch) {
      requestedPackCount = parseInt(multiPackMatch[1]!, 10);
      const pkgAmount = parseFloat(multiPackMatch[2]!);
      const rawPkgUnit = multiPackMatch[3]!.toLowerCase();
      const canonicalPkgUnit = this.canonicalizeUnit(rawPkgUnit);

      packageSize = {
        amount: pkgAmount,
        unit: canonicalPkgUnit,
      };

      originalQuantity = requestedPackCount;
      originalUnit = 'PACK';

      // Dimension normalization: compute total amount and normalize safely
      const totalAmount = requestedPackCount * pkgAmount;
      const normalized = this.normalizeDimension(totalAmount, canonicalPkgUnit);
      normalizedQuantity = normalized.quantity;
      normalizedUnit = normalized.unit;

      workingText = workingText.replace(multiPackWithSizeRegex, ' ').trim();
    } else if (sizeMultiMatch) {
      const pkgAmount = parseFloat(sizeMultiMatch[1]!);
      const rawPkgUnit = sizeMultiMatch[2]!.toLowerCase();
      requestedPackCount = parseInt(sizeMultiMatch[3]!, 10);
      const canonicalPkgUnit = this.canonicalizeUnit(rawPkgUnit);

      packageSize = {
        amount: pkgAmount,
        unit: canonicalPkgUnit,
      };

      originalQuantity = requestedPackCount;
      originalUnit = 'PACK';

      const totalAmount = requestedPackCount * pkgAmount;
      const normalized = this.normalizeDimension(totalAmount, canonicalPkgUnit);
      normalizedQuantity = normalized.quantity;
      normalizedUnit = normalized.unit;

      workingText = workingText.replace(sizeWithMultiPackRegex, ' ').trim();
    } else if (discreteMatch) {
      const count = parseInt(discreteMatch[1]!, 10);
      originalQuantity = count;
      requestedPackCount = count;

      // Extract discrete unit word
      const matchedWord = discreteMatch[0].toLowerCase();
      if (
        matchedWord.includes('bar') ||
        matchedWord.includes('piece') ||
        matchedWord.includes('pc')
      ) {
        originalUnit = 'PIECE';
        normalizedUnit = 'PIECE';
      } else {
        originalUnit = 'PACK';
        normalizedUnit = 'PACK';
      }
      normalizedQuantity = count;

      workingText = workingText.replace(discreteCountRegex, ' ').trim();
    } else if (singleMatch) {
      const amt = parseFloat(singleMatch[1]!);
      const rawPkgUnit = singleMatch[2]!.toLowerCase();
      const canonical = this.canonicalizeUnit(rawPkgUnit);

      originalQuantity = amt;
      originalUnit = canonical;

      const normalized = this.normalizeDimension(amt, canonical);
      normalizedQuantity = normalized.quantity;
      normalizedUnit = normalized.unit;

      workingText = workingText.replace(singleMeasurementRegex, ' ').trim();
    } else {
      // Check for standalone numeric quantity without unit (e.g., "2 bread", "3 soap")
      const standaloneNumMatch = workingText.match(/^\s*(\d+)\s+(.+)$/);
      if (standaloneNumMatch) {
        const count = parseInt(standaloneNumMatch[1]!, 10);
        originalQuantity = count;
        requestedPackCount = count;
        originalUnit = 'PIECE';
        normalizedQuantity = count;
        normalizedUnit = 'PIECE';
        workingText = standaloneNumMatch[2]!.trim();
      }
    }

    // 3. Clean product name: remove residual connector words, punctuation, and extra whitespace
    let cleanedProductName = workingText
      .replace(
        /\b(?:packs?|packets?|bars?|pieces?|bottles?|cans?|of|for|please|send|give|need|get)\b/gi,
        ' ',
      )
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // If product name became empty, recover from original text or brand
    if (!cleanedProductName) {
      cleanedProductName = extractedBrand || rawText.trim();
    }

    // 4. Dimension Incompatibility and Suspicious Unit Detection
    // Strict invariant: Mass normalizes strictly to mass, Volume strictly to volume.
    // Flag dimension mismatches (e.g. shampoo in grams or sugar in ml) without silent conversion.
    let confidence: ParseConfidence = 'EXACT';

    const lowerProductName = cleanedProductName.toLowerCase();
    const isLiquid = LIQUID_PRODUCT_KEYWORDS.some((kw) => lowerProductName.includes(kw));
    const isSolid = SOLID_PRODUCT_KEYWORDS.some((kw) => lowerProductName.includes(kw));

    if (isLiquid && (normalizedUnit === 'KG' || normalizedUnit === 'G')) {
      confidence = 'INCOMPATIBLE';
      ambiguityReasons.push(
        `Incompatible unit: '${cleanedProductName}' is typically a liquid measured in volume (ml/L), but a mass unit (${originalUnit}) was requested. Customer confirmation required.`,
      );
    } else if (isSolid && (normalizedUnit === 'L' || normalizedUnit === 'ML')) {
      confidence = 'INCOMPATIBLE';
      ambiguityReasons.push(
        `Incompatible unit: '${cleanedProductName}' is typically a dry good measured in mass (kg/g), but a volume unit (${originalUnit}) was requested. Customer confirmation required.`,
      );
    }

    // 5. Check for ambiguity when quantity or unit is unspecified
    if (originalQuantity === null || normalizedQuantity === null) {
      confidence = 'AMBIGUOUS';
      ambiguityReasons.push(
        `No explicit quantity or unit specified for '${cleanedProductName}'. Please confirm amount or pack size.`,
      );
    }

    // If completely malformed
    if (cleanedProductName.length <= 1 && confidence !== 'INCOMPATIBLE') {
      confidence = 'MALFORMED';
      ambiguityReasons.push('Line does not contain an identifiable product name');
    }

    return {
      rawText,
      brand: extractedBrand,
      productName: cleanedProductName,
      originalQuantity,
      originalUnit,
      normalizedQuantity,
      normalizedUnit,
      requestedPackCount,
      packageSize,
      confidence,
      ambiguityReasons,
    };
  }

  /**
   * Canonicalizes raw unit string into standard intermediate representation.
   */
  private canonicalizeUnit(rawUnit: string): string {
    const u = rawUnit.toLowerCase();
    if (u === 'kg' || u === 'kgs' || u === 'kilo' || u === 'kilograms' || u === 'kilogram') {
      return 'KG';
    }
    if (u === 'g' || u === 'gm' || u === 'gms' || u === 'grams' || u === 'gram') {
      return 'G';
    }
    if (
      u === 'l' ||
      u === 'lt' ||
      u === 'ltr' ||
      u === 'ltrs' ||
      u === 'litre' ||
      u === 'litres' ||
      u === 'liter' ||
      u === 'liters'
    ) {
      return 'L';
    }
    if (
      u === 'ml' ||
      u === 'mls' ||
      u === 'millilitre' ||
      u === 'millilitres' ||
      u === 'milliliter' ||
      u === 'milliliters'
    ) {
      return 'ML';
    }
    return u.toUpperCase();
  }

  /**
   * Dimension-safe unit normalization.
   * Mass normalizes strictly to Mass (G <-> KG).
   * Volume normalizes strictly to Volume (ML <-> L).
   * Never convert across dimensions!
   */
  private normalizeDimension(
    amount: number,
    unit: string,
  ): { quantity: number; unit: CanonicalUnit } {
    switch (unit) {
      case 'KG':
        return { quantity: Number(amount.toFixed(3)), unit: 'KG' };
      case 'G':
        // If 1000g or more, normalize to KG
        if (amount >= 1000) {
          return { quantity: Number((amount / 1000).toFixed(3)), unit: 'KG' };
        }
        return { quantity: Number(amount.toFixed(3)), unit: 'G' };
      case 'L':
        return { quantity: Number(amount.toFixed(3)), unit: 'L' };
      case 'ML':
        // If 1000ml or more, normalize to L
        if (amount >= 1000) {
          return { quantity: Number((amount / 1000).toFixed(3)), unit: 'L' };
        }
        return { quantity: Number(amount.toFixed(3)), unit: 'ML' };
      case 'PIECE':
        return { quantity: Math.round(amount), unit: 'PIECE' };
      case 'PACK':
        return { quantity: Math.round(amount), unit: 'PACK' };
      default:
        return { quantity: amount, unit: 'PACK' };
    }
  }
}
