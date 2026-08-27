import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { RawQcRow } from './types';

/**
 * Parses either .xlsx or .csv into the same RawQcRow[] shape, keyed by
 * the QC report's column headers exactly as they appear in row 1 (or
 * the CSV header row). Both formats have been observed carrying the
 * identical 42-column schema — same messy values either way — so this
 * is purely a format-detection + normalization step, not two different
 * parsing strategies.
 */
export async function parseQcFile(file: File): Promise<RawQcRow[]> {
  const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type === 'text/csv';

  if (isCsv) {
    return parseQcCsv(file);
  }
  return parseQcXlsx(file);
}

function parseQcXlsx(file: File): Promise<RawQcRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        const rawJson = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
          defval: '',
          raw: true,
        });

        resolve(rawJson.map(normalizeRow));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

function parseQcCsv(file: File): Promise<RawQcRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          console.warn('CSV parse warnings:', results.errors);
        }
        resolve(results.data.map(normalizeRow));
      },
      error: (error) => reject(error),
    });
  });
}

function normalizeRow(row: Record<string, unknown>): RawQcRow {
  const normalized: RawQcRow = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[key] = value !== undefined && value !== null ? String(value) : '';
  });
  return normalized;
}
