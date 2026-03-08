
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
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * A utility function to deeply remove undefined values from an object.
 * Firestore does not support `undefined`.
 * It preserves Firestore FieldValue objects (like increment, arrayUnion).
 */
const sanitizeDataForFirebase = (data: any, stripId: boolean = false): any => {
    if (data === undefined) return null;
    if (data === null || typeof data !== 'object') return data;
    if (data instanceof Date) return data;
    
    // Do not traverse into Firestore FieldValue objects. 
    // They are identified by having a constructor name like 'FieldValue' or 'FieldValueImpl'.
    if (data.constructor && (data.constructor.name === 'FieldValue' || data.constructor.name === 'FieldValueImpl')) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(v => sanitizeDataForFirebase(v, false)); // Don't strip IDs in nested arrays by default
    }

    const result: any = {};
    for (const key in data) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            if (stripId && key === 'id') continue; // Skip document ID for updates to avoid immutable field errors
            const val = data[key];
            if (val !== undefined) {
                result[key] = sanitizeDataForFirebase(val, false);
            }
        }
    }
    return result;
};


/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options: SetOptions) {
  const sanitizedData = sanitizeDataForFirebase(data);
  setDoc(docRef, sanitizedData, options).catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write', // or 'create'/'update' based on options
        requestResourceData: sanitizedData,
      })
    )
  })
}


/**
 * Initiates an addDoc operation for a collection reference.
 * Does NOT await the write operation internally.
 * Returns the Promise for the new doc ref, but typically not awaited by caller.
 */
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


/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  // CRITICAL: We strip the 'id' field for updates because document IDs are immutable.
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
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
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
