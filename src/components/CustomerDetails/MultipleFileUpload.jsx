import React, { useRef } from 'react';
import { Upload, X, Camera, Image as ImageIcon } from 'lucide-react';

export default function MultipleFileUpload({ photos, setPhotos }) {
  const fileInputRef = useRef();

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    
    files.forEach((file) => {
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

    // Reset input
    e.target.value = '';
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
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-primary-600 to-primary-700 text-white font-semibold rounded-lg hover:shadow-lg transition-all text-sm sm:text-base"
          >
            <Upload className="w-4 h-4 sm:w-5 sm:h-5" />
            Upload Photos
          </button>
          
          <button
            onClick={() => {
              fileInputRef.current?.setAttribute('capture', 'camera');
              fileInputRef.current?.click();
            }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold rounded-lg hover:shadow-lg transition-all text-sm sm:text-base"
          >
            <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
            Take Photo
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Info Text */}
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          You can upload multiple photos (delivery proof, damaged items, etc.)
        </p>
      </div>

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

