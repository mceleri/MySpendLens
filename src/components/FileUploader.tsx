import React, { useRef, useState } from 'react';
import { UploadCloud, Check, AlertTriangle } from 'lucide-react';

interface FileUploaderProps {
  onFileLoaded: (content: string, fileName: string) => void;
  isProcessing: boolean;
  disabled: boolean;
  loadedFileName: string | null;
  totalLoaded: number;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
  onFileLoaded,
  isProcessing: _isProcessing,
  disabled,
  loadedFileName,
  totalLoaded,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = (file: File) => {
    setErrorMsg(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMsg('Please select a valid CSV file (.csv).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content || content.trim().length === 0) {
        setErrorMsg('Selected CSV file is empty.');
        return;
      }
      onFileLoaded(content, file.name);
    };
    reader.onerror = () => {
      setErrorMsg('Unable to read selected file.');
    };
    reader.readAsText(file);
  };

  return (
    <section className="uploader-section">
      <div
        className={`dropzone-card ${isDragging ? 'dropzone-active' : ''} ${disabled ? 'dropzone-disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden-file-input"
          onChange={handleFileInput}
          disabled={disabled}
        />

        <div className="dropzone-content">
          <div className="dropzone-icon-wrap">
            <UploadCloud size={32} className="dropzone-icon" />
          </div>

          <div className="dropzone-text">
            <h3 className="dropzone-title">
              Drag & drop bank statement or <span className="text-highlight">browse files</span>
            </h3>
            <p className="dropzone-desc">
              Supports CSV, TSV bank exports or plain text files with transaction descriptions
            </p>
          </div>

          <div className="dropzone-meta">
            <span className="file-format-badge">.CSV</span>
            <span className="file-format-badge">.TXT</span>
            <span className="file-format-badge">.TSV</span>
          </div>
        </div>

        {loadedFileName && (
          <div className="dropzone-loaded-banner" onClick={(e) => e.stopPropagation()}>
            <Check size={16} className="text-emerald" />
            <span>
              Active file: <strong>{loadedFileName}</strong> ({totalLoaded} transactions processed)
            </span>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="uploader-error">
          <AlertTriangle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}
    </section>
  );
};
