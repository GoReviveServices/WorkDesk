'use client';

import { useState } from 'react';
import { UploadCloud, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { processQcFile } from '@/lib/qc-extract/pipeline';
import { useQcImportStore } from '@/store/useQcImportStore';

export function QcUploader() {
  const setGroups = useQcImportStore((s) => s.setGroups);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stageLabel, setStageLabel] = useState('');

  const STAGE_LABELS: Record<string, string> = {
    parsing: 'Reading file…',
    extracting: 'Extracting fields…',
    grouping: 'Grouping identical units…',
    validating: 'Validating against system data…',
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    try {
      const groups = await processQcFile(file, (stage, current, total) => {
        setStageLabel(`${STAGE_LABELS[stage] ?? stage} ${total > 1 ? `(${current}/${total})` : ''}`.trim());
      });
      setGroups(groups);
    } catch (error) {
      console.error('Failed to process QC report:', error);
      alert('There was an error reading the QC report. Please check the file format.');
    } finally {
      setIsProcessing(false);
      setStageLabel('');
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
      'text/csv': ['.csv'],
    },
    multiple: false,
    disabled: isProcessing,
  });

  return (
    <div className="w-full max-w-4xl mx-auto mt-10">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Import from QC Report</h2>
        <p className="text-gray-500 text-sm mt-1">
          Upload the raw QC diagnostic export as-is — no template needed. Accepts .xlsx and .csv.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-200 ease-in-out cursor-pointer outline-none ${
          isDragActive
            ? 'border-purple-500 bg-purple-50 scale-[1.02]'
            : 'border-gray-300 bg-white hover:border-purple-400 hover:bg-purple-50/50'
        }`}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center justify-center text-center">
          {isProcessing ? (
            <Loader2 className="w-16 h-16 text-purple-500 animate-spin mb-4" />
          ) : (
            <div className={`p-4 rounded-full mb-4 ${isDragActive ? 'bg-purple-100' : 'bg-gray-100'}`}>
              <UploadCloud className={`w-10 h-10 ${isDragActive ? 'text-purple-600' : 'text-gray-500'}`} />
            </div>
          )}

          <h3 className="text-lg font-semibold text-gray-800 mb-1">
            {isProcessing
              ? stageLabel || 'Processing…'
              : isDragActive
                ? 'Drop the QC report here!'
                : 'Click or drag the QC report to this area'}
          </h3>
          <p className="text-sm text-gray-500 mb-4">Supports .xlsx and .csv</p>

          {!isProcessing && (
            <div className="flex items-center text-xs font-medium text-purple-600 bg-purple-100 px-3 py-1 rounded-full">
              <FileSpreadsheet className="w-3 h-3 mr-1" />
              Raw diagnostic export — extraction runs automatically
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
