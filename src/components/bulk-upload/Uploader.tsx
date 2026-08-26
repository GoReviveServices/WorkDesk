'use client';

import { useState } from 'react';
import { UploadCloud, FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { downloadTemplate, parseAndValidateExcel } from '@/lib/shared/excelTemplate';
import type { ValidatedRow } from '@/lib/shared/validation';

interface UploaderProps {
  onDataParsed: (rows: ValidatedRow[]) => void;
}

export function Uploader({ onDataParsed }: UploaderProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      const rows = await parseAndValidateExcel(file);
      onDataParsed(rows);
    } catch (error) {
      console.error('Failed to parse file:', error);
      alert('There was an error reading the Excel file. Please ensure it matches the template.');
    } finally {
      setIsProcessing(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles) => {
      const file = acceptedFiles[0];
      if (file) processFile(file);
    },
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    multiple: false,
    disabled: isProcessing,
  });

  return (
    <div className="w-full max-w-4xl mx-auto mt-10">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Bulk Upload Models</h2>
          <p className="text-gray-500 text-sm mt-1">Upload your Excel file to automatically create records.</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors focus:ring-2 focus:ring-orange-500 outline-none"
        >
          <Download className="w-4 h-4 mr-2 text-orange-500" />
          Download Template
        </button>
      </div>

      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out cursor-pointer outline-none ${
          isDragActive
            ? 'border-orange-500 bg-orange-50 scale-[1.02]'
            : 'border-gray-300 bg-white hover:border-orange-400 hover:bg-orange-50/50'
        }`}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center justify-center text-center">
          {isProcessing ? (
            <Loader2 className="w-16 h-16 text-orange-500 animate-spin mb-4" />
          ) : (
            <div className={`p-4 rounded-full mb-4 ${isDragActive ? 'bg-orange-100' : 'bg-gray-100'}`}>
              <UploadCloud className={`w-10 h-10 ${isDragActive ? 'text-orange-600' : 'text-gray-500'}`} />
            </div>
          )}

          <h3 className="text-lg font-semibold text-gray-800 mb-1">
            {isProcessing
              ? 'Processing File...'
              : isDragActive
                ? 'Drop the Excel file here!'
                : 'Click or drag file to this area to upload'}
          </h3>
          <p className="text-sm text-gray-500 mb-4">Supports .xlsx and .xls formats</p>

          {!isProcessing && (
            <div className="flex items-center text-xs font-medium text-orange-600 bg-orange-100 px-3 py-1 rounded-full">
              <FileSpreadsheet className="w-3 h-3 mr-1" />
              Ensure headers match template exactly
            </div>
          )}
        </div>
      </div>
    </div>
  );
}