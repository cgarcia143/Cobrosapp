import { FirebaseError } from 'firebase/app';

const FIREBASE_MESSAGES: Record<string, string> = {
  'permission-denied':
    'No tienes permiso para esta operación. Puede deberse a tu rol o a una suscripción suspendida.',
  unavailable: 'Sin conexión y sin una copia local suficiente para completar la operación.',
  unauthenticated: 'Tu sesión expiró. Vuelve a ingresar.',
  'auth/invalid-credential': 'Correo o contraseña incorrectos.',
  'auth/invalid-email': 'El correo no es válido.',
  'auth/too-many-requests': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
  'auth/network-request-failed': 'No hay conexión para iniciar sesión.',
  'functions/unauthenticated': 'Tu sesión expiró. Vuelve a ingresar.',
  'functions/permission-denied': 'No tienes permiso para esta operación.',
  'functions/failed-precondition': 'La operación no se puede completar en el estado actual.',
  'storage/retry-limit-exceeded': 'No se pudo subir la evidencia. Revisa la conexión.',
  'storage/unauthorized': 'No tienes permiso para subir este archivo.',
};

export class OfflineMediaError extends Error {
  constructor() {
    super(
      'La evidencia de imagen o video requiere conexión. Los pagos de la ruta sí se pueden registrar sin conexión.',
    );
    this.name = 'OfflineMediaError';
  }
}

export function readableError(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code.startsWith('functions/') && error.message) {
      return error.message;
    }
    return FIREBASE_MESSAGES[error.code] ?? error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Ocurrió un error inesperado.';
}
