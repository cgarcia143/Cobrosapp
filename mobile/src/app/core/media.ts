export function readEvidenceFile(file: File): Promise<string> {
  if (file.type.startsWith('image/')) {
    return compressImage(file);
  }
  if (file.size > 2_500_000) {
    return Promise.reject(new Error('El archivo supera 2.5 MB. En el modo local usa una foto más liviana.'));
  }
  return readAsDataUrl(file);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const maxSide = 1280;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      URL.revokeObjectURL(url);
      if (!context) {
        reject(new Error('No se pudo leer la imagen.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.72));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    image.src = url;
  });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la operación.';
}
