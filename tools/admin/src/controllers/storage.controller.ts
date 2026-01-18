import { Request, Response } from 'express';
import { StorageService } from '../services/storage.service';

export class StorageController {
  constructor(private storageService: StorageService) {}

  /**
   * List all buckets
   */
  listBuckets = async (req: Request, res: Response): Promise<void> => {
    try {
      const buckets = await this.storageService.listBuckets();
      res.json({ buckets });
    } catch (error) {
      console.error('Error listing buckets:', error);
      res.status(500).json({ error: 'Failed to list buckets' });
    }
  };

  /**
   * List objects in a bucket
   */
  listObjects = async (req: Request, res: Response): Promise<void> => {
    try {
      const { bucketName } = req.params;
      const prefix = (req.query.prefix as string) || '';
      const maxResults = parseInt(req.query.maxResults as string) || 100;
      const pageToken = req.query.pageToken as string | undefined;

      console.log(
        `Listing objects in bucket "${bucketName}" with prefix="${prefix}", maxResults=${maxResults}, pageToken=${pageToken || 'none'}`
      );

      const result = await this.storageService.listObjects(bucketName, {
        prefix,
        maxResults,
        pageToken,
      });

      console.log(`Found ${result.objects.length} objects in bucket "${bucketName}"`);

      res.json(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`Error listing objects in ${req.params.bucketName}:`, error);
      res.status(500).json({
        error: 'Failed to list objects',
        message: errorMessage,
      });
    }
  };

  /**
   * Get object metadata
   */
  getObject = async (req: Request, res: Response): Promise<void> => {
    try {
      const bucketName = req.params.bucketName;

      // Extract object path from the wildcard route
      // Express stores wildcard matches in req.params[0] or we can use req.path
      let objectPath: string;

      // Try to get from params first (if Express populated it)
      if ((req.params as { [key: string]: string })['0']) {
        objectPath = (req.params as { [key: string]: string })['0'];
      } else {
        // Fallback: extract from path
        const fullPath = req.path;
        const objectsPrefix = `/api/storage/buckets/${bucketName}/objects/`;
        objectPath = fullPath.replace(objectsPrefix, '');
      }

      // Decode the path in case it was URL encoded
      try {
        objectPath = decodeURIComponent(objectPath);
      } catch {
        // If decoding fails, use as-is
      }

      console.log(`Getting object: ${bucketName}/${objectPath} (from path: ${req.path})`);

      if (!objectPath || objectPath === '') {
        res.status(400).json({ error: 'Object path is required' });
        return;
      }

      const object = await this.storageService.getObject(bucketName, objectPath);

      if (!object) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }

      console.log(
        `Successfully retrieved object: ${bucketName}/${objectPath}, URL: ${object.publicUrl.substring(0, 100)}...`
      );
      res.json(object);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error getting object:', error);
      res.status(500).json({
        error: 'Failed to get object',
        message: errorMessage,
      });
    }
  };

  /**
   * Delete an object
   */
  deleteObject = async (req: Request, res: Response): Promise<void> => {
    try {
      const bucketName = req.params.bucketName;
      // Extract object path from the wildcard (everything after /objects/)
      const fullPath = req.path;
      const objectsPrefix = `/api/storage/buckets/${bucketName}/objects/`;
      const objectPath = fullPath.replace(objectsPrefix, '');

      if (!objectPath) {
        res.status(400).json({ error: 'Object path is required' });
        return;
      }

      const { confirm } = req.body;

      if (confirm !== true) {
        res.status(400).json({ error: 'Deletion requires confirm: true' });
        return;
      }

      await this.storageService.deleteObject(bucketName, objectPath);
      res.json({ success: true, message: 'Object deleted successfully' });
    } catch (error) {
      console.error('Error deleting object:', error);
      res.status(500).json({ error: 'Failed to delete object' });
    }
  };

  /**
   * Delete multiple objects
   */
  deleteMultipleObjects = async (req: Request, res: Response): Promise<void> => {
    try {
      const { bucketName } = req.params;
      const { objectPaths, confirm } = req.body;

      if (confirm !== true) {
        res.status(400).json({ error: 'Deletion requires confirm: true' });
        return;
      }

      if (!Array.isArray(objectPaths) || objectPaths.length === 0) {
        res.status(400).json({ error: 'objectPaths must be a non-empty array' });
        return;
      }

      await this.storageService.deleteObjects(bucketName, objectPaths);
      res.json({ success: true, deleted: objectPaths.length });
    } catch (error) {
      console.error('Error deleting objects:', error);
      res.status(500).json({ error: 'Failed to delete objects' });
    }
  };
}
