import React, { useRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';

export default function SignaturePad({ title, onChange }) {
  const sigCanvas = useRef();

  const handleClear = () => {
    sigCanvas.current?.clear();
    onChange('');
  };

  const handleEnd = () => {
    onChange(sigCanvas.current?.toDataURL());
  };

  return (
    <div>
      <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3">{title}</h3>
      <div className="border-2 border-primary-300 rounded-lg">
        <SignatureCanvas
          ref={sigCanvas}
          canvasProps={{
            className: 'w-full h-32 sm:h-40 lg:h-48 cursor-crosshair',
          }}
          onEnd={handleEnd}
        />
      </div>
      <button
        onClick={handleClear}
        className="mt-2 px-3 sm:px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-xs sm:text-sm font-medium"
      >
        Clear Signature
      </button>
    </div>
  );
}

