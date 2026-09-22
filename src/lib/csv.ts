/**
 * CSV parsing and generation utilities.
 * Handles French column name variants and accent-insensitive matching.
 */

export interface ParsedMedicationRow {
  code?: string;
  commercial_name?: string;
  dci?: string;
  active_ingredient?: string;
  strength?: string;
  pharmaceutical_form?: string;
  manufacturer?: string;
  laboratory?: string;
  route?: string;
  default_dosage?: string;
  default_frequency?: string;
  default_duration?: string;
  instructions?: string;
  _rowNumber: number;
  _errors: string[];
}

const COLUMN_MAP: Record<string, keyof ParsedMedicationRow> = {
  'code': 'code',
  'nom commercial': 'commercial_name',
  'nomcommercial': 'commercial_name',
  'commercial_name': 'commercial_name',
  'commercialname': 'commercial_name',
  'dci': 'dci',
  'principe actif': 'active_ingredient',
  'principeactif': 'active_ingredient',
  'active_ingredient': 'active_ingredient',
  'activeingredient': 'active_ingredient',
  'dosage': 'strength',
  'strength': 'strength',
  'forme': 'pharmaceutical_form',
  'forme pharmaceutique': 'pharmaceutical_form',
  'pharmaceutical_form': 'pharmaceutical_form',
  'pharmaceuticalform': 'pharmaceutical_form',
  'laboratoire': 'manufacturer',
  'manufacturer': 'manufacturer',
  'lab': 'laboratory',
  'laboratory': 'laboratory',
  'voie': 'route',
  'route': 'route',
  'posologie': 'default_dosage',
  'default_dosage': 'default_dosage',
  'defaultdosage': 'default_dosage',
  'frequence': 'default_frequency',
  'fréquence': 'default_frequency',
  'default_frequency': 'default_frequency',
  'defaultfrequency': 'default_frequency',
  'duree': 'default_duration',
  'durée': 'default_duration',
  'default_duration': 'default_duration',
  'defaultduration': 'default_duration',
  'instructions': 'instructions',
  'consignes': 'instructions',
};

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_\-]+/g, ' ')
    .trim();
}

export function parseCSV(text: string): ParsedMedicationRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(normalizeKey);
  const rows: ParsedMedicationRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: ParsedMedicationRow = { _rowNumber: i + 1, _errors: [] };

    for (let j = 0; j < headers.length && j < values.length; j++) {
      const headerKey = headers[j];
      const fieldName = COLUMN_MAP[headerKey];
      if (fieldName && fieldName !== '_rowNumber' && fieldName !== '_errors') {
        (row as unknown as Record<string, unknown>)[fieldName] = values[j]?.trim() || undefined;
      }
    }

    if (!row.commercial_name) {
      row._errors.push('Nom commercial manquant');
    }

    rows.push(row);
  }

  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else if (char === ';' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export function generateCSV(medications: Record<string, unknown>[]): string {
  const headers = [
    'Code', 'Nom commercial', 'DCI', 'Principe actif', 'Dosage',
    'Forme', 'Laboratoire', 'Voie', 'Posologie', 'Fréquence',
    'Durée', 'Instructions',
  ];

  const lines = [headers.join(',')];

  for (const med of medications) {
    const values = [
      med.code ?? '',
      med.commercial_name ?? '',
      med.dci ?? '',
      med.active_ingredient ?? '',
      med.strength ?? '',
      med.pharmaceutical_form ?? med.form ?? '',
      med.manufacturer ?? '',
      med.route ?? '',
      med.default_dosage ?? '',
      med.default_frequency ?? '',
      med.default_duration ?? '',
      med.instructions ?? '',
    ].map((v) => {
      const s = String(v ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob(['\ufeff' + content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse an Excel file (.xlsx) using a minimal SheetXML parser.
 * This avoids adding a heavy dependency like xlsx/exceljs.
 * Falls back to CSV parsing if the file is actually CSV.
 */
export async function parseExcelFile(file: File): Promise<ParsedMedicationRow[]> {
  const ext = file.name.toLowerCase().split('.').pop();

  if (ext === 'csv') {
    const text = await file.text();
    return parseCSV(text);
  }

  // For .xlsx/.xls files, we use the SheetJS library loaded dynamically
  // to avoid bundling it in the main app
  try {
    const XLSX = await import('xlsx');
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    const rows: ParsedMedicationRow[] = json.map((row, i) => {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(row)) {
        const normKey = normalizeKey(key);
        const fieldName = COLUMN_MAP[normKey];
        if (fieldName) {
          normalized[fieldName] = String(row[key] ?? '').trim() || undefined;
        }
      }
      const result: ParsedMedicationRow = {
        ...normalized,
        _rowNumber: i + 2,
        _errors: [],
      } as ParsedMedicationRow;
      if (!result.commercial_name) {
        result._errors.push('Nom commercial manquant');
      }
      return result;
    });

    return rows;
  } catch {
    // If xlsx library is not available, try parsing as CSV
    const text = await file.text();
    return parseCSV(text);
  }
}
