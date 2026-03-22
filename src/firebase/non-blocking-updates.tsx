'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';

/**
 * A utility function to deeply remove undefined values from an object.
 * Firestore does not support `undefined`.
 * It preserves Firestore FieldValue objects (like increment, arrayUnion).
 */
const sanitizeDataForFirebase = (data: any, stripId: boolean = false): any => {
    if (data === undefined) return null;
    if (data === null || typeof data !== 'object') return data;
    if (data instanceof Date) return data;
    
    /**
     * CRITICAL FIX: Robust FieldValue detection.
     * In some build environments, constructor.name might be mangled.
     * We check for known FieldValue signatures to ensure arrayUnion/increment 
     * are never recursed into or stripped.
     */
    const isFieldValue = data && (
        data.constructor?.name?.includes('FieldValue') || 
        '_methodName' in data || 
        (typeof data.toJSON === 'function' && data.toJSON()?.['_methodName'])
    );

    if (isFieldValue) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(v => sanitizeDataForFirebase(v, false));
    }

    const result: any = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            // CRITICAL: Document IDs are immutable in Firestore. 
            // We MUST strip the 'id' field for updates to prevent permission errors.
            if (stripId && key === 'id') continue; 
            const val = data[key];
            if (val !== undefined) {
                result[key] = sanitizeDataForFirebase(val, false);
            }
        }
    }
    return result;
};

export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  const sanitizedData = sanitizeDataForFirebase(data);
  setDoc(docRef, sanitizedData, options).catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write',
        requestResourceData: sanitizedData,
      })
    )
  })
}

export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  const sanitizedData = sanitizeDataForFirebase(data);
  const promise = addDoc(colRef, sanitizedData)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
          requestResourceData: sanitizedData,
        })
      )
    });
  return promise;
}

export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  // CRITICAL: Strip 'id' field to prevent permission errors from immutable field updates
  const sanitizedData = sanitizeDataForFirebase(data, true);
  updateDoc(docRef, sanitizedData)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: sanitizedData,
        })
      );
    });
}

export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
