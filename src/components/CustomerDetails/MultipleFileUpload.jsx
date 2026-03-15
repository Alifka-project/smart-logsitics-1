import React, { useRef, useState, useEffect } from 'react';
import { Upload, X, Camera, Image as ImageIcon } from 'lucide-react';

export default function MultipleFileUpload({ photos, setPhotos }) {
  const fileInputRef = useRef();
  const videoRef = useRef();
  const streamRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const addFilesAsPhotos = (files) => {
    const fileList = Array.from(files);
    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        setPhotos((prev) => [...prev, {
          id: Date.now() + Math.random(),
          data: event.target.result,
          name: file.name,
          type: file.type,
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const addDataUrlAsPhoto = (dataUrl) => {
    setPhotos((prev) => [...prev, {
      id: Date.now() + Math.random(),
      data: dataUrl,
      name: `camera-${Date.now()}.jpg`,
      type: 'image/jpeg',
    }]);
  };

  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files?.length) addFilesAsPhotos(files);
    e.target.value = '';
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
    setCameraError('');
  };

  const openCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported in this browser. Use Upload Photos instead.');
      return;
    }
    const constraints = [
      { video: { facingMode: 'environment' }, audio: false },
      { video: { facingMode: 'user' }, audio: false },
      { video: true, audio: false },
    ];
    for (const config of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(config);
        streamRef.current = stream;
        setCameraOpen(true);
        return;
      } catch (err) {
        const isOverconstrained = err.name === 'OverconstrainedError';
        const isNotFound = err.name === 'NotFoundError';
        if (err.name === 'NotAllowedError') {
          setCameraError('Camera access denied. Please allow camera in browser settings.');
          return;
        }
        if (!isOverconstrained && !isNotFound) {
          console.error('[MultipleFileUpload] Camera error:', err);
          setCameraError('Could not open camera. Try again or use Upload Photos.');
          return;
        }
      }
    }
    setCameraError('No camera found. Use Upload Photos to add images from your device.');
  };

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(console.error);
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [cameraOpen]);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !streamRef.current || video.readyState < 2) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    addDataUrlAsPhoto(dataUrl);
    stopCamera();
  };

  const handleRemovePhoto = (photoId) => {
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
  };

  return (
    <div>
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
        <Camera className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        📸 Upload Delivery Photos
      </h3>
      
      {/* Upload Button */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold rounded-lg hover:shadow-lg transition-all text-sm sm:text-base"
          >
            <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
            Upload Photos
          </button>
          
          <button
            type="button"
            onClick={openCamera}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:shadow-lg transition-all text-sm sm:text-base"
          >
            <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
            Take Photo
          </button>
        </div>

        {cameraError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {cameraError}
          </p>
        )}

        {/* Upload from gallery/files only */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-label="Upload photos from device"
        />

        {/* Info Text */}
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          You can upload multiple photos (delivery proof, damaged items, etc.)
        </p>
      </div>

      {/* Camera overlay – opens camera directly, no album */}
      {cameraOpen && (
        <div className="fixed inset-0 z-[10000] bg-black flex flex-col items-center justify-center">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="max-w-full max-h-[70vh] w-full object-contain bg-black"
          />
          <div className="flex gap-4 p-4">
            <button
              type="button"
              onClick={capturePhoto}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg"
            >
              Capture Photo
            </button>
            <button
              type="button"
              onClick={stopCamera}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Photo Grid */}
      {photos.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Uploaded Photos ({photos.length})
            </span>
            <button
              onClick={() => setPhotos([])}
              className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-medium"
            >
              Remove All
            </button>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {photos.map((photo) => (
              <div
                key={photo.id}
                className="relative group rounded-lg overflow-hidden border-2 border-gray-200 dark:border-gray-700 hover:border-primary-400 dark:hover:border-primary-500 transition-colors"
              >
                <img
                  src={photo.data}
                  alt={photo.name}
                  className="w-full h-32 object-cover"
                />
                
                {/* Overlay on Hover */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
                  <button
                    onClick={() => handleRemovePhoto(photo.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-red-600 text-white rounded-full hover:bg-red-700"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* File Name */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-2">
                  <p className="text-xs text-white truncate">
                    {photo.name}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {photos.length === 0 && (
        <div className="mt-4 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-8 text-center">
          <ImageIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">No photos uploaded yet</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Click buttons above to add photos
          </p>
        </div>
      )}
    </div>
  );
}

