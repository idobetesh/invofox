import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FirestoreService } from '../services/firestore.service';

export class FirestoreController {
  constructor(private firestoreService: FirestoreService) {}

  /**
   * List all Firestore collections
   */
  listCollections = async (req: Request, res: Response): Promise<void> => {
    try {
      const collections = this.firestoreService.getKnownCollections();
      res.json({ collections });
    } catch (error) {
      console.error('Error listing collections:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to list collections' });
    }
  };

  /**
   * List documents in a collection with pagination
   */
  listDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const { collectionName } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const startAfter = req.query.startAfter as string | undefined;

      const result = await this.firestoreService.listDocuments(collectionName, {
        limit,
        startAfter,
      });

      res.json(result);
    } catch (error) {
      console.error(`Error listing documents in ${req.params.collectionName}:`, error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to list documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Get a specific document
   */
  getDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { collectionName, documentId } = req.params;
      const document = await this.firestoreService.getDocument(collectionName, documentId);

      if (!document) {
        res.status(StatusCodes.NOT_FOUND).json({ error: 'Document not found' });
        return;
      }

      res.json(document);
    } catch (error) {
      console.error('Error getting document:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to get document' });
    }
  };

  /**
   * Delete a document
   */
  deleteDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { collectionName, documentId } = req.params;
      const { confirm } = req.body;

      if (confirm !== true) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'Deletion requires confirm: true in request body' });
        return;
      }

      await this.firestoreService.deleteDocument(collectionName, documentId);
      res.json({ success: true, message: 'Document deleted successfully' });
    } catch (error) {
      console.error('Error deleting document:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to delete document' });
    }
  };

  /**
   * Delete multiple documents
   */
  deleteMultipleDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const { collectionName } = req.params;
      const { documentIds, confirm } = req.body;

      if (confirm !== true) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Deletion requires confirm: true' });
        return;
      }

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'documentIds must be a non-empty array' });
        return;
      }

      await this.firestoreService.deleteDocuments(collectionName, documentIds);
      res.json({ success: true, deleted: documentIds.length });
    } catch (error) {
      console.error('Error deleting documents:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Failed to delete documents' });
    }
  };

  /**
   * Update a document
   */
  updateDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { collectionName, documentId } = req.params;
      console.log(`Update request: ${req.method} ${req.path}`, { collectionName, documentId });

      const { data, confirm } = req.body;

      if (confirm !== true) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Update requires confirm: true' });
        return;
      }

      if (!data || typeof data !== 'object') {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'data must be a valid object' });
        return;
      }

      const updatedDocument = await this.firestoreService.updateDocument(
        collectionName,
        documentId,
        data
      );

      res.json({
        success: true,
        message: 'Document updated successfully',
        document: updatedDocument,
      });
    } catch (error) {
      console.error('Error updating document:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to update document: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}
